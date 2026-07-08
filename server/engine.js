// Deck & Dominion game engine — one Game instance per session.
// Holds all state in memory (import/export replaces DB persistence).
const { CARDS, starterDeckList } = require('./cards');

let UID = 1;
const uid = () => 'u' + (UID++);

const KW_LIST = ['haste', 'trample', 'deathtouch', 'lifelink', 'firststrike', 'taunt', 'fragile', 'nospell', 'noattack', 'immune', 'indestructible', 'kwlock', 'voidtouch'];

function parseKw(k) {
  const [name, val] = String(k).split(':');
  return { name, val: val ? parseInt(val, 10) : 0 };
}

class Game {
  constructor(code, hostName) {
    this.code = code;
    this.state = 'lobby'; // lobby | playing | ended
    this.hostName = hostName;
    this.players = {}; // pid -> player
    this.spectators = {}; // pid -> {name}
    this.dm = { hp: 40, maxHp: 40, deck: [], hand: [], decks: [], lands: [], landsPlayed: 0 };
    this.shared = { hp: 32, maxHp: 32, shield: 0, manaPersist: 0, manaBurst: 0 };
    this.board = []; // units, side: 'party' | 'dm'
    this.grave = []; // shared party graveyard (ordered, newest first)
    this.exilePile = [];
    this.dmGrave = [];
    this.dmExile = [];
    this.turn = { round: 0, current: null, phase: 'draw', acted: [], pickingNext: false };
    this.log = [];
    this.chat = [];
    this.history = [];
    this.future = [];
    this.paused = false;
    this.pendingReaction = null;
    this.gifts = []; // {id, from, to, cards, status}
    this.giftHistory = [];
    this.artOverrides = {}; // cardId -> dataURL
    this.diedThisTurn = 0;
    this.diedLastRound = 0;
    this.totalSacrificed = 0;
    this.winner = null;
    this.seq = 0;
  }

  // ---------- helpers ----------
  addLog(msg, type = 'info') {
    this.log.push({ i: this.log.length, t: Date.now(), msg, type });
    if (this.log.length > 2000) this.log.splice(0, 500);
  }
  card(id) { return CARDS[id]; }
  player(pid) { return this.players[pid]; }
  isDM(pid) { return pid === 'dm' || (this.players[pid] && this.players[pid].isDM); }

  snapshot() {
    const { history, future, ...rest } = this;
    return JSON.stringify(rest, (k, v) => (k === 'sockets' ? undefined : v));
  }
  pushHistory(label) {
    this.history.push({ label, snap: this.snapshot() });
    if (this.history.length > 150) this.history.shift();
    this.future = [];
  }
  restore(snap) {
    const data = JSON.parse(snap);
    const keep = { history: this.history, future: this.future };
    Object.assign(this, data, keep);
  }
  undo() {
    if (!this.history.length) return false;
    const cur = { label: 'redo-point', snap: this.snapshot() };
    const prev = this.history.pop();
    this.future.push(cur);
    this.restore(prev.snap);
    this.addLog('DM: undo (' + prev.label + ')', 'dm');
    return true;
  }
  redo() {
    if (!this.future.length) return false;
    const nxt = this.future.pop();
    this.history.push({ label: 'undo-point', snap: this.snapshot() });
    this.restore(nxt.snap);
    this.addLog('DM: redo', 'dm');
    return true;
  }
  rewind(idx) {
    if (idx < 0 || idx >= this.history.length) return false;
    this.history.push({ label: 'pre-rewind', snap: this.snapshot() });
    this.restore(this.history[idx].snap);
    this.addLog('DM: rewound game state', 'dm');
    return true;
  }

  // ---------- lobby ----------
  addPlayer(pid, name, spectator = false) {
    if (spectator) { this.spectators[pid] = { name }; return; }
    this.players[pid] = {
      id: pid, name, cls: null, arch: null, ready: false, connected: true,
      collection: {}, decks: [], favorites: [], activeDeck: null,
      deck: [], hand: [], mulligans: 0, landsPlayed: 0, lands: [],
    };
  }
  giveStarterDeck(pid, cls, arch) {
    const p = this.players[pid]; if (!p) return;
    const sd = starterDeckList(cls, arch); if (!sd) return;
    p.cls = cls; p.arch = arch;
    for (const id of sd.cards) p.collection[id] = (p.collection[id] || 0) + 1;
    if (!p.decks.find(d => d.name === sd.name)) p.decks.push({ name: sd.name, cards: sd.cards.slice() });
    p.activeDeck = sd.name;
    this.addLog(`${p.name} chose ${cls}/${arch} and received the ${sd.name} deck`);
  }

  // ---------- unit construction ----------
  makeUnit(cardId, side, owner, over = {}) {
    const c = this.card(cardId) || {};
    const u = {
      uid: uid(), cardId, name: over.name || c.name || cardId, side, owner,
      type: over.type || c.type || 'creature', tribe: over.tribe || c.tribe || null,
      baseAtk: over.a != null ? over.a : (c.atk || 0),
      baseHp: over.h != null ? over.h : (c.hp || 1),
      permA: 0, permH: 0, dmg: 0, shield: 0,
      turnBuffs: [], kwTemp: [], kwPerm: (over.kw || c.kw || []).slice(),
      poison: [], equips: [], attacksUsed: 0,
      enteredRound: this.turn.round, cantAttack: 0, suppressed: 0,
      token: !!over.token, tempTurns: over.tempTurns || 0, exileOnDeath: !!over.exileOnDeath,
      returnHandOnDeath: !!(over.returnHandOnDeath || c.returnHandOnDeath),
      usedAbility: false, killCount: 0, splitsOnDeath: !!over.splitsOnDeath,
      deathDmg: over.deathDmg || 0, note: over.note || null,
    };
    for (const k of u.kwPerm) {
      const { name, val } = parseKw(k);
      if (name === 'shield') u.shield += val;
    }
    return u;
  }

  countPer(per, ctx = {}) {
    const [key, divS] = String(per).split(':');
    const div = divS ? parseInt(divS, 10) : 1;
    const friendly = this.board.filter(x => x.side === (ctx.side || 'party'));
    const enemySide = (ctx.side || 'party') === 'party' ? 'dm' : 'party';
    const grave = (ctx.side || 'party') === 'party' ? this.grave : this.dmGrave;
    switch (key) {
      case 'tribe': return friendly.filter(x => x.tribe === divS && (!ctx.other || x.uid !== (ctx.self && ctx.self.uid))).length;
      case 'kw': return friendly.filter(x => this.hasKw(x, divS)).length;
      case 'grave': return Math.floor(grave.length / div);
      case 'graveCreatures': { const n = grave.filter(g => (CARDS[g.cardId] || {}).type === 'creature' || g.wasCreature).length; return divS ? Math.floor(n / div) : n; }
      case 'graveSpells': return grave.filter(g => ['spell', 'reaction'].includes((CARDS[g.cardId] || {}).type)).length;
      case 'mana': return Math.floor((this.shared.manaPersist + this.shared.manaBurst) / div);
      case 'cheaperFriendly': return friendly.filter(x => x.uid !== (ctx.self && ctx.self.uid) && (CARDS[x.cardId] || { cost: 0 }).cost < (CARDS[ctx.self ? ctx.self.cardId : ''] || { cost: 0 }).cost).length;
      case 'maxFriendlyAtk': return Math.max(0, ...friendly.filter(x => x.type === 'creature').map(x => this.stats(x).atk));
      case 'enemyCreatures': return this.board.filter(x => x.side === enemySide && x.type === 'creature').length;
      case 'components': return friendly.filter(x => (CARDS[x.cardId] || {}).component).length;
      case 'sacCount': return (ctx.sacrificed || []).length;
      case 'sacCost': return (ctx.sacrificed || []).reduce((s, x) => s + ((CARDS[x.cardId] || {}).cost || 0), 0);
      case 'sacHealth': return (ctx.sacrificed || []).reduce((s, x) => s + x.hp, 0);
      case 'sacAttack': return (ctx.sacrificed || []).reduce((s, x) => s + x.atk, 0);
      case 'exileCost': return (ctx.exiled || []).reduce((s, x) => s + ((CARDS[x.cardId] || {}).cost || 0), 0);
      case 'exileHealth': return (ctx.exiled || []).reduce((s, x) => s + ((CARDS[x.cardId] || {}).hp || 0), 0);
      case 'diedThisTurn': return this.diedThisTurn;
      case 'diedLastRound': return this.diedLastRound;
      case 'totalSacrificed': return this.totalSacrificed;
      default: return 0;
    }
  }

  amount(v, ctx = {}) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    let n = this.countPer(v.per, ctx) * (v.n != null ? v.n : 1) * (v.mult || 1);
    if (v.max != null) n = Math.min(n, v.max);
    return n;
  }

  hasKw(u, kw) {
    if (this.isSuppressed(u) && !['taunt'].includes(kw)) {
      // suppression removes abilities & keywords except nothing special; treat all lost
    }
    if (this.isSuppressed(u)) return false;
    const all = [...u.kwPerm, ...u.kwTemp.map(k => k.kw), ...u.equips.flatMap(e => e.kw || [])];
    if (u.kwRemovedTurn && u.kwRemovedTurn.includes('all')) return false;
    if (u.kwRemovedTurn && u.kwRemovedTurn.includes(kw)) return false;
    return all.some(k => parseKw(k).name === kw);
  }
  kwVal(u, kw) {
    if (this.isSuppressed(u)) return 0;
    let v = 0;
    for (const k of [...u.kwPerm, ...u.kwTemp.map(x => x.kw), ...u.equips.flatMap(e => e.kw || [])]) {
      const p = parseKw(k); if (p.name === kw) v = Math.max(v, p.val);
    }
    return v;
  }
  isSuppressed(u) { return u.suppressed === 'perm' || (typeof u.suppressed === 'number' && u.suppressed > 0); }

  stats(u) {
    const c = CARDS[u.cardId] || {};
    let atk = u.baseAtk + u.permA, hp = u.baseHp + u.permH;
    for (const b of u.turnBuffs) { atk += b.a || 0; hp += b.h || 0; }
    for (const e of u.equips) {
      let ea = e.a || 0;
      if (c.equipAtkDouble) ea *= 2;
      atk += ea; hp += e.h || 0;
    }
    if (!this.isSuppressed(u)) {
      if (c.scaling) {
        const s = c.scaling;
        const mult = this.countPer(s.per, { side: u.side, self: u, other: s.other });
        atk += (s.a || 0) * mult; hp += (s.h || 0) * mult;
      }
      if (c.condBuff) {
        const cb = c.condBuff;
        if ((cb.grave && this.grave.length >= cb.grave)) { atk += cb.a || 0; hp += cb.h || 0; }
      }
    }
    // auras from other units
    for (const src of this.board) {
      if (src.side !== u.side) continue;
      const sc = CARDS[src.cardId] || {};
      const aura = sc.aura;
      if (!aura || this.isSuppressed(src)) continue;
      if (aura.other && src.uid === u.uid) continue;
      let match = false;
      if (aura.scope === 'friendly') match = u.type === 'creature';
      else if (aura.scope && aura.scope.startsWith('tribe:')) match = u.tribe === aura.scope.slice(6);
      else if (aura.scope && aura.scope.startsWith('kw:')) match = this.hasKw(u, aura.scope.slice(3));
      else if (aura.scope === 'towers') match = u.type === 'tower';
      if (match) { atk += aura.a || 0; hp += aura.h || 0; }
    }
    atk = Math.max(0, atk);
    const effHp = hp - u.dmg;
    return { atk, hp, effHp };
  }

  maxAttacks(u) { return this.hasKw(u, 'haste') ? 2 : 1; }
  canAttackNow(u) {
    if (u.type !== 'creature') return false;
    if (u.cantAttack > 0) return false;
    if (this.stats(u).atk <= 0) return false;
    if (u.enteredRound === this.turn.round && !this.hasKw(u, 'haste') && !u.rezHaste) return false;
    return u.attacksUsed < this.maxAttacks(u);
  }

  // ---------- zones ----------
  graveFor(side) { return side === 'party' ? this.grave : this.dmGrave; }
  exileFor(side) { return side === 'party' ? this.exilePile : this.dmExile; }

  toGrave(side, entry) { this.graveFor(side).unshift(entry); }

  die(u, opts = {}) {
    const idx = this.board.findIndex(x => x.uid === u.uid);
    if (idx < 0) return;
    // guard towers
    if (!opts.noGuard && u.type === 'creature' && u.side === 'party') {
      const guard = this.board.find(x => x.side === 'party' && (CARDS[x.cardId] || {}).guard === 'die' && !this.isSuppressed(x));
      if (guard && guard.uid !== u.uid) {
        this.addLog(`${guard.name} is destroyed instead of ${u.name}`);
        u.dmg = 0;
        this.die(guard, { noGuard: true });
        return;
      }
      const gate = this.board.find(x => x.side === 'party' && (CARDS[x.cardId] || {}).guard === 'bounce' && !this.isSuppressed(x) && !x.usedGuardRound);
      if (gate && u.owner !== 'dm' && !u.token) {
        gate.usedGuardRound = this.turn.round;
        this.board.splice(idx, 1);
        const p = this.players[u.owner];
        if (p) { p.hand.push({ inst: uid(), cardId: u.cardId }); this.addLog(`${gate.name} returns ${u.name} to ${p.name}'s hand instead of dying`); }
        return;
      }
    }
    this.board.splice(idx, 1);
    this.diedThisTurn++;
    this.lastDeath = { cardId: u.cardId, side: u.side, owner: u.owner, name: u.name, ghost: true };
    this.addLog(`${u.name} dies`, 'combat');
    // equipment destroyed with creature
    for (const e of u.equips) this.toGrave(u.side, { cardId: e.cardId, name: e.name });
    if (u.returnHandOnDeath && u.owner !== 'dm' && this.players[u.owner]) {
      this.players[u.owner].hand.push({ inst: uid(), cardId: u.cardId });
      this.addLog(`${u.name} returns to hand`);
    } else if (u.exileOnDeath || opts.exile) {
      this.exileFor(u.side).unshift({ cardId: u.cardId, name: u.name, token: u.token, wasCreature: true });
    } else {
      this.toGrave(u.side, { cardId: u.cardId, name: u.name, token: u.token, wasCreature: true });
    }
    // death triggers
    const c = CARDS[u.cardId] || {};
    if (!this.isSuppressed(u) && !u.suppressTriggers) {
      if (u.deathDmg) this.act({ t: 'randomEnemy', dmg: u.deathDmg }, { side: u.side, self: u, owner: u.owner });
      if (u.splitsOnDeath) {
        const half = Math.ceil(u.baseAtk / 2) || 1;
        for (let i = 0; i < 2; i++) this.board.push(this.makeUnit(u.cardId, u.side, u.owner, { name: u.name, a: half, h: Math.ceil(u.baseHp / 2) || 1, token: true }));
      }
      if (c.death) this.runActions(c.death, { side: u.side, self: u, owner: u.owner });
    }
    // other units' triggers
    for (const other of this.board.slice()) {
      const oc = CARDS[other.cardId] || {};
      if (this.isSuppressed(other) || other.suppressTriggers) continue;
      if (oc.allyDeath && other.side === u.side && other.uid !== u.uid) {
        for (const a of oc.allyDeath) {
          if (a.ifTribe && u.tribe !== a.ifTribe) continue;
          this.act(a, { side: other.side, self: other, owner: other.owner, subject: u });
        }
      }
      if (oc.enemyDeath && other.side !== u.side) this.runActions(oc.enemyDeath, { side: other.side, self: other, owner: other.owner, subject: u });
      if (oc.anyDeath) this.runActions(oc.anyDeath, { side: other.side, self: other, owner: other.owner, subject: u });
    }
    this.checkEnd();
  }

  checkDeaths() {
    let changed = true;
    let loops = 0;
    while (changed && loops++ < 30) {
      changed = false;
      for (const u of this.board.slice()) {
        const s = this.stats(u);
        if (s.effHp <= 0 && !this.hasKw(u, 'indestructible')) { this.die(u); changed = true; }
      }
    }
  }

  // ---------- damage ----------
  damageUnit(u, n, src = {}) {
    if (n <= 0) return 0;
    if (this.hasKw(u, 'immune')) { this.addLog(`${u.name} is immune to damage`); return 0; }
    let dealt = n;
    if (u.shield > 0) {
      const absorbed = Math.min(u.shield, dealt);
      u.shield -= absorbed; dealt -= absorbed;
      if (absorbed) this.addLog(`${u.name}'s shield absorbs ${absorbed}`, 'combat');
    }
    if (this.hasKw(u, 'fragile') && n > 0) {
      this.addLog(`${u.name} (illusion) shatters`, 'combat');
      this.die(u);
      return n;
    }
    if (dealt > 0) {
      u.dmg += dealt;
      this.addLog(`${u.name} takes ${dealt} damage`, 'combat');
      const c = CARDS[u.cardId] || {};
      if (c.damaged && !this.isSuppressed(u) && !u.suppressTriggers) {
        const survived = this.stats(u).effHp > 0;
        for (const a of c.damaged) {
          if (a.ifSurvived && !survived) continue;
          this.act(a, { side: u.side, self: u, owner: u.owner });
        }
      }
      // retaliate
      if (src.attacker) {
        const r = this.kwVal(u, 'retaliate');
        if (r > 0) this.damageUnit(src.attacker, r, {});
      }
    }
    if (src.deathtouch && dealt > 0) {
      this.addLog(`Deathtouch destroys ${u.name}`, 'combat');
      u.dmg = Math.max(u.dmg, this.stats(u).hp);
    }
    if (src.poison && dealt > 0) u.poison.push({ x: src.poison, rounds: 3 });
    if (src.voidExile && this.stats(u).effHp <= 0) u.exileOnDeath = true;
    this.checkDeaths();
    return dealt;
  }

  damageFace(side, n, src = {}) {
    if (n <= 0) return;
    if (side === 'party') {
      const wall = this.board.find(x => x.side === 'party' && (CARDS[x.cardId] || {}).playerDamageRedirect && !this.isSuppressed(x));
      if (wall) { this.addLog(`Damage redirected to ${wall.name}`); this.damageUnit(wall, n, src); return; }
      if (this.shared.shield > 0) {
        const ab = Math.min(this.shared.shield, n);
        this.shared.shield -= ab; n -= ab;
        if (ab) this.addLog(`Party shield absorbs ${ab}`, 'combat');
      }
      if (n > 0) { this.shared.hp -= n; this.addLog(`Party takes ${n} damage (${this.shared.hp} HP left)`, 'combat'); }
    } else {
      this.dm.hp -= n;
      this.addLog(`DM takes ${n} damage (${this.dm.hp} HP left)`, 'combat');
      if (src.attacker) {
        const c = CARDS[src.attacker.cardId] || {};
        if (c.faceDamage && !this.isSuppressed(src.attacker)) this.runActions(c.faceDamage, { side: src.attacker.side, self: src.attacker, owner: src.attacker.owner });
      }
    }
    this.checkEnd();
  }

  healFace(side, n) {
    if (side === 'party') { this.shared.hp = Math.min(this.shared.maxHp, this.shared.hp + n); this.addLog(`Party heals ${n} (${this.shared.hp} HP)`); }
    else { this.dm.hp = Math.min(this.dm.maxHp, this.dm.hp + n); this.addLog(`DM heals ${n}`); }
  }

  checkEnd() {
    if (this.state !== 'playing') return;
    if (this.shared.hp <= 0) { this.state = 'ended'; this.winner = 'dm'; this.addLog('Party HP reached 0 — the DM wins the encounter!', 'system'); }
    else if (this.dm.hp <= 0) { this.state = 'ended'; this.winner = 'party'; this.addLog('DM HP reached 0 — the party wins!', 'system'); }
  }

  // ---------- action interpreter ----------
  resolveTargets(a, ctx) {
    const side = ctx.side, enemy = side === 'party' ? 'dm' : 'party';
    switch (a.t) {
      case 'self': return ctx.self ? [ctx.self] : [];
      case 'reactionSubject': case 'rezSubject': return ctx.subject ? [ctx.subject] : [];
      case 'attacker': return ctx.attacker ? [ctx.attacker] : [];
      case 'allFriendly': return this.board.filter(x => x.side === side && x.type === 'creature' && this.matchFilter(x, a.filter) && (!a.exceptSubject || !ctx.subject || x.uid !== ctx.subject.uid) && (!a.onlyAttacked || x.attacksUsed > 0));
      case 'allEnemy': return this.board.filter(x => x.side === enemy && x.type === 'creature' && this.matchFilter(x, a.filter));
      case 'allCreatures': return this.board.filter(x => x.type === 'creature');
      case 'friendlyTowers': return this.board.filter(x => x.side === side && (x.type === 'tower' || x.type === 'persistent'));
      case 'randomEnemy': { const opts = this.board.filter(x => x.side === enemy && x.type === 'creature'); return opts.length ? [opts[Math.floor(Math.random() * opts.length)]] : []; }
      case 'randomFriendly': { const opts = this.board.filter(x => x.side === side && x.type === 'creature'); return opts.length ? [opts[Math.floor(Math.random() * opts.length)]] : []; }
      default: {
        // explicit targets from client
        const ids = ctx.targets || [];
        return ids.map(id => this.board.find(x => x.uid === id)).filter(Boolean);
      }
    }
  }
  matchFilter(u, f) {
    if (!f) return true;
    for (const part of String(f).split(',')) {
      const [k, v] = part.split(':');
      if (k === 'tribe' && u.tribe !== v) return false;
      if (k === 'kw' && !this.hasKw(u, v)) return false;
      if (k === 'attacked' && u.attacksUsed === 0) return false;
      if (k === 'hpMax' && this.stats(u).effHp > parseInt(v, 10)) return false;
      if (k === 'atkMin' && this.stats(u).atk < parseInt(v, 10)) return false;
      if (k === 'atkMax' && this.stats(u).atk > parseInt(v, 10)) return false;
      if (k === 'costMax' && ((CARDS[u.cardId] || {}).cost || 0) > parseInt(v, 10)) return false;
    }
    return true;
  }

  runActions(actions, ctx) { for (const a of actions || []) this.act(a, ctx); }

  act(a, ctx) {
    const side = ctx.side || 'party';
    const enemy = side === 'party' ? 'dm' : 'party';
    // conditional gate
    if (a.cond) {
      const ok = (a.cond.grave && this.graveFor(side).length >= a.cond.grave)
        || (a.cond.graveCreatures && this.countPer('graveCreatures', { side }) >= a.cond.graveCreatures)
        || (a.cond.components && this.countPer('components', { side }) >= a.cond.components);
      const b = Object.assign({}, a);
      delete b.cond;
      if (!ok) {
        if (a.elseDmg != null) b.dmg = a.elseDmg;
        if (a.elseMana != null) b.mana = a.elseMana;
        if (a.elseDraw != null) b.draw = a.elseDraw;
        if (a.elseHeal != null) b.heal = a.elseHeal;
        if (a.elseDur != null) b.dur = a.elseDur;
        if (a.elseDmg == null && a.elseMana == null && a.elseDraw == null && a.elseHeal == null && a.elseDur == null) {
          // condition failed and no fallback → skip entirely
          return;
        }
      }
      delete b.elseDmg; delete b.elseMana; delete b.elseDraw; delete b.elseHeal; delete b.elseDur;
      return this.act(b, ctx);
    }
    if (a.flip) {
      const heads = Math.random() < 0.5;
      this.addLog(`Coin flip: ${heads ? 'HEADS (good)' : 'TAILS (bad)'}`, 'combat');
      return this.runActions(heads ? a.flip.heads : a.flip.tails, ctx);
    }
    if (a.choose) {
      const idx = ctx.choice || 0;
      const opt = a.choose[Math.min(idx, a.choose.length - 1)];
      return this.runActions(opt.acts, ctx);
    }
    if (a.exileCost) { // startTurn "exile N from graveyard, if you do..."
      const g = this.graveFor(side).filter(x => !x.token);
      if (g.length < a.exileCost) return;
      for (let i = 0; i < a.exileCost; i++) {
        const idx = this.graveFor(side).findIndex(x => !x.token);
        if (idx >= 0) this.exileFor(side).unshift(this.graveFor(side).splice(idx, 1)[0]);
      }
      this.addLog(`Exiled ${a.exileCost} card(s) from the graveyard`);
    }

    const targets = this.resolveTargets(a, ctx);
    // verbs applying to targets
    for (const u of targets) {
      if (a.dmg != null) {
        let n = this.amount(a.dmg, Object.assign({ side }, ctx));
        if (a.surviveIfHpMin && u.side === side && this.stats(u).hp >= a.surviveIfHpMin) {
          const eff = this.stats(u).effHp;
          n = Math.min(n, Math.max(0, eff - 1));
        }
        this.damageUnit(u, n, { deathtouch: false });
      }
      if (a.destroy) { u.dmg = 9999; }
      if (a.destroyExile) { u.exileOnDeath = true; u.dmg = 9999; }
      if (a.healC != null) { const n = this.amount(a.healC, ctx); u.dmg = Math.max(0, u.dmg - n); this.addLog(`${u.name} restores ${n} health`); }
      if (a.shieldC != null) u.shield += this.amount(a.shieldC, ctx);
      if (a.shieldAfter != null) u.shield += a.shieldAfter;
      if (a.buffA != null || a.buffH != null) {
        const ba = this.amount(a.buffA || 0, Object.assign({ side }, ctx)), bh = this.amount(a.buffH || 0, Object.assign({ side }, ctx));
        if (a.dur === 'perm' || a.dur == null) { u.permA += ba; u.permH += bh; }
        else u.turnBuffs.push({ a: ba, h: bh, expires: a.dur === 'turn' ? 1 : a.dur });
        this.addLog(`${u.name} gets ${ba >= 0 ? '+' : ''}${ba}/${bh >= 0 ? '+' : ''}${bh}${a.dur === 'turn' ? ' this turn' : a.dur === 'perm' || a.dur == null ? '' : ` for ${a.dur} turns`}`);
      }
      if (a.setStats) { u.baseAtk = a.setStats.a; u.baseHp = a.setStats.h; u.permA = 0; u.permH = 0; u.dmg = 0; u.equips = []; }
      if (a.kw) {
        const kws = a.kw;
        if (a.dur === 'perm') u.kwPerm.push(...kws);
        else u.kwTemp.push(...kws.map(k => ({ kw: k, expires: a.dur === 'turn' || a.dur == null ? 1 : a.dur })));
        this.addLog(`${u.name} gains ${kws.join(', ')}${a.dur === 'perm' ? ' permanently' : ''}`);
        for (const k of kws) { const p = parseKw(k); if (p.name === 'shield') u.shield += p.val; }
      }
      if (a.kwPick && ctx.kwChoice) {
        const chosen = ctx.kwChoice.slice(0, a.kwPick.n || 1);
        u.kwTemp.push(...chosen.map(k => ({ kw: k, expires: 1 })));
        this.addLog(`${u.name} gains ${chosen.join(', ')} this turn`);
      }
      if (a.kwUpgrade) {
        const k = this.hasKw(u, a.kwUpgrade.has) ? a.kwUpgrade.then : a.kwUpgrade.else;
        u.kwTemp.push({ kw: k, expires: 1 });
        this.addLog(`${u.name} gains ${k} this turn`);
      }
      if (a.removeKw) {
        if (a.dur === 'perm') { u.kwPerm = a.removeKw === 'all' ? [] : u.kwPerm.filter(k => !a.removeKw.includes(parseKw(k).name)); u.kwTemp = []; }
        else { u.kwRemovedTurn = (u.kwRemovedTurn || []).concat(a.removeKw === 'all' ? ['all'] : a.removeKw); }
        this.addLog(`${u.name} loses ${a.removeKw === 'all' ? 'all keywords' : a.removeKw.join(', ')}`);
      }
      if (a.suppress) { u.suppressed = a.dur === 'perm' ? 'perm' : (a.dur === 'turn' || a.dur == null ? 1 : a.dur); this.addLog(`${u.name}'s abilities are negated`); }
      if (a.cantAttack) { u.cantAttack = Math.max(u.cantAttack, a.cantAttack); this.addLog(`${u.name} cannot attack for ${a.cantAttack} turn(s)`); }
      if (a.cleanse) { u.poison = []; u.cantAttack = 0; if (u.suppressed !== 'perm') u.suppressed = 0; u.turnBuffs = u.turnBuffs.filter(b => (b.a || 0) >= 0 && (b.h || 0) >= 0); this.addLog(`${u.name} is cleansed`); }
      if (a.poison) { u.poison.push({ x: this.amount(a.poison, ctx), rounds: 3 }); this.addLog(`${u.name} is poisoned`); }
      if (a.extraAttack && a.extraAttack.scope === 'target') { u.attacksUsed = 0; u.rezHaste = true; this.addLog(`${u.name} may attack again`); }
      if (a.split) {
        const s = this.stats(u);
        const round = a.split.round === 'up' ? Math.ceil : Math.floor;
        const ha = Math.max(a.split.round === 'up' ? 1 : 0, round(s.atk / 2)), hh = Math.max(1, round(s.hp / 2));
        this.die(u, { noGuard: true });
        for (let i = 0; i < 2; i++) this.board.push(this.makeUnit(u.cardId, u.side, u.owner, { name: u.name, a: ha, h: hh, token: true }));
        this.addLog(`${u.name} splits into two ${ha}/${hh}s`);
      }
      if (a.copyC) this.doCopy(a.copyC, u, ctx);
      if (a.destroyEquipOnVictim) { for (const e of u.equips.splice(0)) { this.toGrave(u.side, { cardId: e.cardId, name: e.name }); this.addLog(`${e.name} is destroyed`); } }
      if (a.dmgAllEnemyFromAtk) { const n = this.stats(u).atk; for (const e of this.board.filter(x => x.side === enemy && x.type === 'creature')) this.damageUnit(e, n, {}); }
      if (a.destroyGainManaCost) { this.shared.manaBurst += (CARDS[u.cardId] || { cost: 0 }).cost || 0; u.dmg = 9999; }
      if (a.manaPerTarget) this.addMana(side, a.manaPerTarget, 'burst');
      if (a.exile) { const idx = this.board.findIndex(x => x.uid === u.uid); if (idx >= 0) { this.board.splice(idx, 1); this.exileFor(u.side).unshift({ cardId: u.cardId, name: u.name, wasCreature: true }); this.addLog(`${u.name} is exiled`); } }
      if (a.draw && a.t === 'player') { /* handled below via targetPlayer */ }
    }
    // untargeted / side verbs
    if (a.dmg != null && !targets.length && a.t === 'any' && ctx.faceTarget) {
      this.damageFace(ctx.faceTarget === 'dm' ? 'dm' : 'party', this.amount(a.dmg, Object.assign({ side }, ctx)), {});
    }
    if (a.t === 'casterFace' && a.dmg != null) {
      this.damageFace(this.pendingReaction ? this.pendingReaction.bySide : enemy, this.amount(a.dmg, ctx), {});
    }
    if (a.t === 'dmface' && a.dmg != null) this.damageFace('dm', this.amount(a.dmg, Object.assign({ side }, ctx)), {});
    if (a.heal != null && !a.healC) this.healFace(side, this.amount(a.heal, Object.assign({ side }, ctx)));
    if (a.healFull) { if (side === 'party') this.shared.hp = this.shared.maxHp; else this.dm.hp = this.dm.maxHp; this.addLog('HP fully restored'); }
    if (a.shield != null && !targets.length) { if (side === 'party') this.shared.shield += this.amount(a.shield, Object.assign({ side }, ctx)); }
    if (a.loseHP != null) { const n = this.amount(a.loseHP, Object.assign({ side }, ctx)); if (side === 'party') { this.shared.hp -= n; this.addLog(`Party loses ${n} HP`); } else { this.dm.hp -= n; } this.checkEnd(); }
    if (a.mana != null) this.addMana(side, this.amount(a.mana, Object.assign({ side }, ctx)), ctx.manaKind || 'auto');
    if (a.loseMana != null) { const n = a.loseMana; const takeB = Math.min(this.shared.manaBurst, n); this.shared.manaBurst -= takeB; this.shared.manaPersist = Math.max(0, this.shared.manaPersist - (n - takeB)); this.addLog(`Lost ${n} mana`); }
    if (a.draw != null && (!a.t || a.t === 'self')) this.drawCards(ctx.owner, this.amount(a.draw, Object.assign({ side }, ctx)));
    if (a.draw != null && a.t === 'player') this.drawCards(ctx.targetPlayer || ctx.owner, this.amount(a.draw, ctx));
    if (a.draw != null && a.t === 'allPlayers') for (const pid of Object.keys(this.players)) this.drawCards(pid, this.amount(a.draw, ctx));
    if (a.discardRandom) { const p = this.players[ctx.owner]; if (p) for (let i = 0; i < a.discardRandom && p.hand.length; i++) { const idx = Math.floor(Math.random() * p.hand.length); const c = p.hand.splice(idx, 1)[0]; this.toGrave('party', { cardId: c.cardId, name: (CARDS[c.cardId] || {}).name }); this.addLog(`${p.name} discards ${(CARDS[c.cardId] || {}).name}`); } }
    if (a.token) this.doToken(a.token, ctx);
    if (a.rez) this.doRez(a.rez, ctx);
    if (a.rezSubject && ctx.subject) {
      const sub = ctx.subject;
      const g = this.graveFor(side);
      const gi = g.findIndex(x => x.cardId === sub.cardId && !x.token);
      if (gi >= 0) g.splice(gi, 1);
      const nu = this.makeUnit(sub.cardId, side, ctx.owner, {});
      if (a.rezSubject.hp1) nu.dmg = Math.max(0, this.stats(nu).hp - 1);
      if (a.rezSubject.temp) nu.tempTurns = 1;
      this.board.push(nu);
      this.addLog(`${nu.name} returns to the board`);
    }
    if (a.reclaim) this.doReclaim(a.reclaim, ctx);
    if (a.bounce) this.doBounce(a.bounce, ctx);
    if (a.destroyT) this.doDestroy(a, ctx);
    if (a.extraAttack && a.extraAttack.scope !== 'target') {
      const scope = a.extraAttack.scope;
      for (const u of this.board.filter(x => x.side === side && x.type === 'creature')) {
        if (scope === 'attacked' && u.attacksUsed === 0) continue;
        if (scope === 'killed' && !u.killedThisTurn) continue;
        u.attacksUsed = 0; u.rezHaste = true;
      }
      this.addLog('Creatures may attack again');
    }
    if (a.untapAll) {
      const lands = side === 'party' ? Object.values(this.players).flatMap(p => p.lands) : this.dm.lands;
      for (const l of lands) l.tapped = false;
      this.addLog('Lands untapped');
    }
    if (a.schedule) {
      this.turnFx = this.turnFx || [];
      this.turnFx.push({ when: a.schedule.when, t: a.schedule.t, dmg: a.schedule.dmg, side, uids: a.schedule.t === 'allFriendly' ? this.board.filter(x => x.side === side && x.type === 'creature').map(x => x.uid) : null });
    }
    if (a.scheduleSelf && targets.length) {
      this.turnFx = this.turnFx || [];
      for (const u of targets) this.turnFx.push({ when: 'endTurn', uids: [u.uid], dmg: a.scheduleSelf.dmg, destroy: a.scheduleSelf.destroy, side });
    }
    if (a.negate && this.pendingReaction && this.pendingReaction.kind === 'spell') this.pendingReaction.negated = true;
    if (a.redirectAttack && this.pendingReaction && this.pendingReaction.kind === 'attack' && ctx.redirectTo) this.pendingReaction.newTarget = ctx.redirectTo;
    if (a.survive && ctx.subject) {
      const s = ctx.subject;
      if (s.ghost) {
        // creature already died — pull it back from the graveyard with 1 health
        const g = this.graveFor(s.side);
        const gi = g.findIndex(x => x.cardId === s.cardId);
        if (gi >= 0) g.splice(gi, 1);
        const nu = this.makeUnit(s.cardId, s.side, s.owner, {});
        nu.dmg = Math.max(0, this.stats(nu).hp - 1);
        if (a.shieldAfter) nu.shield += a.shieldAfter;
        this.board.push(nu);
        this.addLog(`${nu.name} survives with 1 health`);
      } else {
        s.dmg = Math.max(0, this.stats(s).hp - 1);
        if (a.shieldAfter) s.shield += a.shieldAfter;
        this.addLog(`${s.name} survives with 1 health`);
      }
    }
    if (a.apocalypse) {
      const friendly = this.board.filter(x => x.type === 'creature' && x.side === side).length;
      for (const u of this.board.slice()) if (u.type === 'creature') this.die(u);
      this.damageFace(enemy, friendly * 2);
      this.addMana(side, friendly, 'burst');
      this.addLog(`Apocalypse: ${friendly} friendly creatures died — ${friendly * 2} damage to DM, ${friendly} mana`);
    }
    if (a.oblivion) {
      const n = this.grave.length;
      this.exilePile.unshift(...this.grave.splice(0));
      for (const u of this.board.filter(x => x.side === enemy && x.type === 'creature')) {
        u.permH -= n;
        if (this.stats(u).effHp <= 0) u.exileOnDeath = true;
      }
      this.addLog(`Oblivion: exiled ${n} cards; all enemy creatures get -${n} health`);
      this.checkDeaths();
    }
    if (a.magnumOpus) {
      const comps = this.board.filter(x => x.side === side && (CARDS[x.cardId] || {}).component);
      const names = new Set(comps.map(x => x.cardId));
      if (names.size >= 4) {
        for (const cmp of comps) { const i = this.board.findIndex(x => x.uid === cmp.uid); if (i >= 0) { this.board.splice(i, 1); this.exileFor(side).unshift({ cardId: cmp.cardId, name: cmp.name }); } }
        this.board.push(this.makeUnit('cra_philosophersstone', side, ctx.owner, {}));
        this.addLog('MAGNUM OPUS! The Philosopher\'s Stone is created!', 'system');
      } else this.addLog('Magnum Opus fizzles — all 4 components are not assembled', 'system');
    }
    if (a.peek) this.doPeek(a.peek, ctx);
    if (a.exileFromGrave) {
      const g = a.exileFromGrave.side === 'dm' ? this.dmGrave : this.graveFor(side);
      const gi = (ctx.gravePicks || [])[0] != null ? ctx.gravePicks[0] : g.findIndex(x => (CARDS[x.cardId] || {}).type === 'creature' && !x.token);
      if (gi >= 0 && gi < g.length) {
        const e = g.splice(gi, 1)[0];
        (a.exileFromGrave.side === 'dm' ? this.dmExile : this.exileFor(side)).unshift(e);
        this.addLog(`${e.name || e.cardId} is exiled from the graveyard`);
      }
    }
    if (a.manual) this.addLog(`Manual effect — resolve at the table: ${ctx.cardText || ''}`, 'manual');
    this.checkDeaths();
  }

  // ---------- peeks (look at deck/hand/graveyard, then reorder/bottom/exile/take) ----------
  doPeek(pk, ctx) {
    this.peeks = this.peeks || [];
    const token = uid();
    let items = [], ref = null;
    if (pk.hand === 'dm') {
      items = this.dm.hand.map(h => ({ cardId: h.cardId }));
      this.peeks.push({ token, for: ctx.owner, kind: 'hand', title: "DM's hand", items, opts: {} });
      this.addLog(`${(this.players[ctx.owner] || { name: 'DM' }).name} looks at the DM's hand`);
      return;
    }
    if (pk.deck === 'grave' || pk.deck === 'dmgrave') {
      const g = pk.deck === 'dmgrave' ? this.dmGrave : this.graveFor(ctx.side);
      items = g.slice(0, pk.n || 5).map((e, i) => ({ cardId: e.cardId, idx: i }));
      ref = { zone: pk.deck, side: ctx.side };
    } else {
      let deckOwner = pk.deck === 'dm' ? 'dm' : pk.deck === 'self' ? ctx.owner : (ctx.deckChoice || 'dm');
      if (pk.deck === 'any' && ctx.deckChoice) deckOwner = ctx.deckChoice;
      const deck = deckOwner === 'dm' ? this.dm.deck : (this.players[deckOwner] || { deck: [] }).deck;
      items = deck.slice(0, pk.n || 1).map((id, i) => ({ cardId: id, idx: i }));
      ref = { zone: 'deck', owner: deckOwner };
    }
    if (!items.length) { this.addLog('Nothing to look at'); return; }
    this.peeks.push({ token, for: ctx.owner, kind: 'peek', title: `Top ${items.length} card(s)`, items, ref, opts: { reorder: pk.reorder, bottom: pk.bottom, exile: pk.exile, keep: pk.keep, discardRest: pk.discardRest, takeToHand: pk.takeToHand, optional: pk.optional } });
    this.addLog(`${(this.players[ctx.owner] || { name: 'DM' }).name || 'DM'} looks at ${items.length} card(s)`);
  }

  resolvePeek(pid, token, resp = {}) {
    this.pendingPeeks = this.pendingPeeks || {};
    const pk = this.pendingPeeks[token];
    if (!pk || pk.for !== pid) return { err: 'No such peek' };
    delete this.pendingPeeks[token];
    if (pk.kind === 'hand' || !pk.ref) return { ok: true };
    const n = pk.items.length;
    if (pk.ref.zone === 'deck') {
      const deck = pk.ref.owner === 'dm' ? this.dm.deck : (this.players[pk.ref.owner] || { deck: [] }).deck;
      const top = deck.splice(0, n);
      const used = new Set();
      const toBottom = [], toExile = [], toHand = [], toGraveL = [];
      for (const i of resp.exile || []) if (top[i] != null && !used.has(i)) { toExile.push(top[i]); used.add(i); }
      for (const i of resp.bottom || []) if (top[i] != null && !used.has(i)) { toBottom.push(top[i]); used.add(i); }
      for (const i of resp.take || []) if (top[i] != null && !used.has(i)) { toHand.push(top[i]); used.add(i); }
      let rest;
      if (resp.order && resp.order.length) rest = resp.order.filter(i => !used.has(i)).map(i => top[i]).filter(x => x != null);
      else rest = top.filter((_, i) => !used.has(i));
      if (pk.opts.keep && pk.opts.discardRest) {
        const keepIdx = (resp.take || resp.keep || [0])[0];
        // already handled via take; discard remainder
        for (const c of rest) toGraveL.push(c);
        rest = [];
      }
      deck.unshift(...rest);
      deck.push(...toBottom);
      const side = pk.ref.owner === 'dm' ? 'dm' : 'party';
      for (const c of toExile) this.exileFor(side).unshift({ cardId: c, name: (CARDS[c] || {}).name });
      for (const c of toGraveL) this.toGrave(side, { cardId: c, name: (CARDS[c] || {}).name });
      const p = this.players[pid];
      for (const c of toHand) if (p) p.hand.push({ inst: uid(), cardId: c });
      if (toExile.length) this.addLog(`${toExile.length} card(s) exiled from the top of the deck`);
      if (toBottom.length) this.addLog(`${toBottom.length} card(s) put on the bottom`);
      if (resp.order && resp.order.length) this.addLog('Top cards reordered');
    } else {
      // graveyard peek: takeToHand
      const g = pk.ref.zone === 'dmgrave' ? this.dmGrave : this.graveFor(pk.ref.side);
      const takes = (resp.take || []).slice(0, pk.opts.takeToHand || 0).sort((a, b) => b - a);
      const p = this.players[pid];
      for (const i of takes) {
        if (i >= 0 && i < Math.min(pk.items.length, g.length)) {
          const e = g.splice(i, 1)[0];
          if (p && !e.token) { p.hand.push({ inst: uid(), cardId: e.cardId }); this.addLog(`${p.name} takes ${(CARDS[e.cardId] || {}).name} from the graveyard`); }
        }
      }
    }
    return { ok: true };
  }

  doToken(tk, ctx) {
    let n = typeof tk.n === 'object' ? this.amount(tk.n, ctx) : (tk.n || 1);
    if (ctx.tokenCountOverride != null) n = ctx.tokenCountOverride;
    let a = tk.a, h = tk.h;
    if (tk.fromSacStats && ctx.sacrificed) {
      a = ctx.sacrificed.reduce((s, x) => s + x.atk, 0) + (tk.bonusA || 0);
      h = ctx.sacrificed.reduce((s, x) => s + x.hp, 0) + (tk.bonusH || 0);
    }
    for (let i = 0; i < n; i++) {
      this.board.push(this.makeUnit('token', ctx.side, ctx.owner, {
        name: tk.name, a: a || 1, h: h || 1, kw: tk.kw || [], tribe: tk.tribe, token: true,
        type: tk.type || 'creature', tempTurns: tk.tempTurns || 0, deathDmg: tk.deathDmg || 0,
        splitsOnDeath: tk.splitsOnDeath,
      }));
    }
    if (n > 0) this.addLog(`Created ${n} ${tk.name} token(s)`);
  }

  doRez(rz, ctx) {
    const side = ctx.side;
    const fromSide = rz.fromSide === 'dm' ? 'dm' : side;
    const g = this.graveFor(fromSide);
    const picks = (ctx.gravePicks || []).slice(0, rz.n || 1);
    let done = 0;
    const tryRez = (gi) => {
      if (gi < 0 || gi >= g.length) return false;
      const entry = g[gi];
      const c = CARDS[entry.cardId];
      if (!c || entry.token) return false;
      if (rz.typeFilter && c.type !== rz.typeFilter) return false;
      if (!rz.typeFilter && c.type !== 'creature') return false;
      if (rz.max != null && (c.cost || 0) > rz.max) return false;
      if (rz.nameFilter && c.name !== rz.nameFilter) return false;
      g.splice(gi, 1);
      const u = this.makeUnit(entry.cardId, side, ctx.owner, { kw: (c.kw || []).concat(rz.kw || []) });
      if (rz.a) u.permA += rz.a; if (rz.h) u.permH += rz.h;
      if (rz.half) { u.baseAtk = Math.floor(u.baseAtk / 2); u.baseHp = Math.max(1, Math.floor(u.baseHp / 2)); }
      if (rz.dblHp) u.baseHp *= 2;
      if (rz.shield) u.shield += rz.shield;
      if (rz.temp) u.tempTurns = 1;
      if (rz.exileAfter) u.exileOnDeath = true;
      if (rz.returnHandOnDeath) u.returnHandOnDeath = true;
      if (rz.deathDmg) u.deathDmg = rz.deathDmg;
      if (rz.kwPick && ctx.kwChoice && ctx.kwChoice[0]) u.kwPerm.push(ctx.kwChoice[0]);
      u.rezHaste = this.hasKw(u, 'haste');
      this.board.push(u);
      this.addLog(`${u.name} returns from the graveyard${rz.temp ? ' (until end of turn)' : ''}`);
      // rez triggers
      for (const other of this.board) {
        const oc = CARDS[other.cardId] || {};
        if (oc.rezTrigger && other.side === side && other.uid !== u.uid && !this.isSuppressed(other)) {
          this.runActions(oc.rezTrigger, { side, self: other, owner: other.owner, subject: u });
        }
      }
      done++;
      return true;
    };
    if (picks.length) {
      // picks are grave indices; process descending so indices stay valid
      for (const gi of picks.slice().sort((x, y) => y - x)) { if (done >= (rz.n || 1)) break; tryRez(gi); }
    } else {
      // auto-pick (highestCost / lowerCostThan / first valid)
      const valid = g.map((e, i) => ({ e, i })).filter(({ e }) => {
        const c = CARDS[e.cardId];
        if (!c || e.token) return false;
        if (rz.typeFilter ? c.type !== rz.typeFilter : c.type !== 'creature') return false;
        if (rz.max != null && (c.cost || 0) > rz.max) return false;
        if (rz.nameFilter && c.name !== rz.nameFilter) return false;
        if (rz.lowerCostThanSubject && ctx.subject && (c.cost || 0) >= ((CARDS[ctx.subject.cardId] || {}).cost || 0)) return false;
        return true;
      });
      if (valid.length) {
        let pick = valid[0];
        if (rz.highestCost) pick = valid.reduce((b, x) => ((CARDS[x.e.cardId].cost || 0) > (CARDS[b.e.cardId].cost || 0) ? x : b));
        const limit = Math.min(rz.n || 1, rz.fromSide === 'dm' && rz.n === 99 ? valid.length : (rz.n || 1));
        let count = 0;
        while (count < limit) {
          const v = valid.find(x => g[x.i] === x.e) || null;
          if (rz.highestCost) { tryRez(g.indexOf(pick.e)); break; }
          const gi = g.indexOf((valid[count] || {}).e);
          if (gi < 0) break;
          tryRez(gi); count++;
        }
      }
    }
  }

  doReclaim(rc, ctx) {
    const g = this.graveFor(ctx.side);
    const owner = this.players[ctx.owner];
    const pickIdx = (ctx.gravePicks || [])[0];
    let gi = pickIdx;
    if (gi == null || gi < 0 || gi >= g.length) {
      const valid = g.map((e, i) => ({ e, i })).filter(({ e }) => {
        const c = CARDS[e.cardId];
        if (!c || e.token) return false;
        if (rc.typeFilter && c.type !== rc.typeFilter) return false;
        if (rc.tribe && !(c.tribe === rc.tribe)) return false;
        if (rc.max != null && (c.cost || 0) > rc.max) return false;
        return true;
      });
      if (!valid.length) return;
      gi = rc.random ? valid[Math.floor(Math.random() * valid.length)].i : valid[0].i;
    }
    const entry = g[gi];
    const c = CARDS[entry.cardId];
    if (!c || entry.token) return;
    if (rc.max != null && (c.cost || 0) > rc.max) return;
    g.splice(gi, 1);
    if (owner) { owner.hand.push({ inst: uid(), cardId: entry.cardId }); this.addLog(`${c.name} returns to ${owner.name}'s hand`); }
    else { this.dm.hand.push({ inst: uid(), cardId: entry.cardId }); this.addLog(`${c.name} returns to the DM's hand`); }
  }

  doBounce(b, ctx) {
    let units;
    if (b.t === 'allFriendly') units = this.board.filter(x => x.side === ctx.side && x.type === 'creature' && (b.hpMax == null || this.stats(x).effHp <= b.hpMax));
    else if (b.t === 'reactionSubject') units = ctx.subject ? [ctx.subject] : [];
    else units = (ctx.targets || []).map(id => this.board.find(x => x.uid === id)).filter(Boolean);
    if (b.n && !b.hpMax) units = units.slice(0, b.n);
    for (const u of units) {
      if (b.costMax != null && ((CARDS[u.cardId] || {}).cost || 0) > b.costMax) continue;
      const idx = this.board.findIndex(x => x.uid === u.uid);
      if (idx < 0) continue;
      this.board.splice(idx, 1);
      if (u.token) { this.addLog(`${u.name} (token) vanishes`); continue; }
      if (u.owner === 'dm') this.dm.hand.push({ inst: uid(), cardId: u.cardId });
      else if (this.players[u.owner]) this.players[u.owner].hand.push({ inst: uid(), cardId: u.cardId });
      this.addLog(`${u.name} returns to hand`);
      if (b.drawPer) this.drawCards(ctx.owner, b.drawPer);
    }
  }

  doDestroy(a, ctx) {
    const d = a.destroyT;
    const filters = String(d.filter || '').split(',');
    const targets = (ctx.targets || []).map(id => this.board.find(x => x.uid === id)).filter(Boolean)
      .filter(u => filters.includes(u.type) || (filters.includes('equip') && false));
    let destroyed = 0;
    // equipment destruction via unit-target: client may pass {equip: uid} — handle unit equips
    for (const u of targets.slice(0, d.n || 1)) {
      this.die(u, { noGuard: true });
      destroyed++;
    }
    // targeted equipment on creatures
    for (const eq of (ctx.equipTargets || [])) {
      const holder = this.board.find(x => x.uid === eq.unit);
      if (holder) {
        const i = holder.equips.findIndex(e => e.eid === eq.eid);
        if (i >= 0) { const e = holder.equips.splice(i, 1)[0]; this.toGrave(holder.side, { cardId: e.cardId, name: e.name }); this.addLog(`${e.name} is destroyed`); destroyed++; }
      }
    }
    if (a.tokenPerDestroyed && destroyed) this.doToken(Object.assign({}, a.tokenPerDestroyed, { n: destroyed }), ctx);
    if (a.manaFromCostPlus != null && destroyed) { /* handled via first target cost */ }
  }

  doCopy(cp, target, ctx) {
    let src = target;
    if (cp.src === 'strongestEnemy') {
      const es = this.board.filter(x => x.side !== ctx.side && x.type === 'creature');
      if (!es.length) return;
      src = es.reduce((b, x) => (this.stats(x).atk > this.stats(b).atk ? x : b));
    }
    if (cp.src === 'grave' || cp.src === 'anywhere' || cp.src === 'randomGrave') {
      const pool = [...this.grave, ...this.dmGrave].filter(e => !e.token && CARDS[e.cardId] && CARDS[e.cardId].type === 'creature');
      if (!pool.length) return;
      let entry;
      if (cp.src === 'randomGrave') entry = pool[Math.floor(Math.random() * pool.length)];
      else entry = pool[(ctx.gravePicks || [0])[0]] || pool[0];
      const c = CARDS[entry.cardId];
      const over = cp.mode === 'oneone' ? { a: 1, h: 1, kw: [] } : {};
      const u = this.makeUnit(entry.cardId, ctx.side, ctx.owner, Object.assign({ token: true, tempTurns: cp.temp ? 1 : 0 }, over));
      if (cp.mode === 'oneone') u.suppressed = 'perm';
      this.board.push(u);
      this.addLog(`Created a copy of ${c.name}`);
      return;
    }
    if (!src) return;
    const s = this.stats(src);
    const over = { token: true, tempTurns: cp.temp ? 1 : (cp.tempTurns || 0), name: src.name };
    if (cp.mode === 'oneone') { over.a = 1; over.h = 1; over.kw = []; }
    else if (cp.mode === 'half') { over.a = Math.floor(s.atk / 2); over.h = Math.max(1, Math.floor(s.hp / 2)); }
    else { over.a = src.baseAtk; over.h = src.baseHp; }
    if (cp.hMinus) over.h = Math.max(1, over.h - cp.hMinus);
    const u = this.makeUnit(src.cardId, ctx.side, ctx.owner, over);
    if (cp.mode === 'oneone') u.suppressed = 'perm';
    if (cp.kw) u.kwPerm.push(...cp.kw);
    this.board.push(u);
    this.addLog(`Created a ${cp.mode === 'oneone' ? '1/1 ' : ''}copy of ${src.name}`);
  }

  addMana(side, n, kind = 'persist') {
    if (n <= 0) return;
    if (side === 'party') {
      if (kind === 'burst') this.shared.manaBurst += n; else this.shared.manaPersist += n;
      this.addLog(`+${n} mana to the shared pool${kind === 'burst' ? ' (burst — expires end of turn)' : ''}`);
    } else {
      this.dm.mana = (this.dm.mana || 0) + n;
      this.addLog(`DM gains ${n} mana`);
    }
  }

  refundMana(side, n) {
    if (n <= 0) return;
    if (side === 'dm') this.dm.mana = (this.dm.mana || 0) + n;
    else this.shared.manaPersist += n;
  }

  spendMana(side, n) {
    if (side === 'dm') {
      if ((this.dm.mana || 0) < n) return false;
      this.dm.mana -= n; return true;
    }
    if (this.shared.manaBurst + this.shared.manaPersist < n) return false;
    const b = Math.min(this.shared.manaBurst, n);
    this.shared.manaBurst -= b;
    this.shared.manaPersist -= (n - b);
    return true;
  }

  drawCards(pid, n) {
    if (pid === 'dm') {
      for (let i = 0; i < n; i++) { const c = this.dm.deck.shift(); if (!c) { this.addLog('DM deck is empty!'); break; } this.dm.hand.push({ inst: uid(), cardId: c }); }
      if (n > 0) this.addLog(`DM draws ${n} card(s)`);
      return;
    }
    const p = this.players[pid]; if (!p) return;
    for (let i = 0; i < n; i++) {
      const c = p.deck.shift();
      if (!c) { this.addLog(`${p.name}'s deck is empty!`, 'system'); break; }
      p.hand.push({ inst: uid(), cardId: c });
    }
    if (n > 0) this.addLog(`${p.name} draws ${n} card(s)`);
  }

  // ---------- playing cards ----------
  // payload: {inst, targets:[uid], sacs:[uid], discards:[inst], exiles:[graveIdx], gravePicks:[idx],
  //           choice, kwChoice:[kw], equipTarget: uid, redirectTo: uid, targetPlayer: pid}
  playCard(pid, payload) {
    const isDM = pid === 'dm';
    const actor = isDM ? this.dm : this.players[pid];
    if (!actor) return { err: 'No such player' };
    const hand = actor.hand;
    const hi = hand.findIndex(h => h.inst === payload.inst);
    if (hi < 0) return { err: 'Card not in hand' };
    const cardId = hand[hi].cardId;
    const c = CARDS[cardId];
    if (!c) return { err: 'Unknown card' };
    const side = isDM ? 'dm' : 'party';
    const isReaction = !!payload.asReaction;

    if (!isReaction) {
      if (this.turn.current !== pid) return { err: 'Not your turn' };
      if (this.turn.phase !== 'play' && c.type !== 'land') return { err: 'You can only play cards in the Play phase' };
    }

    // land
    if (c.type === 'land') {
      const maxLands = isDM ? Object.keys(this.players).length : 1;
      if ((actor.landsPlayed || 0) >= maxLands) return { err: 'Land limit reached this turn' };
      actor.landsPlayed = (actor.landsPlayed || 0) + 1;
      hand.splice(hi, 1);
      actor.lands.push({ id: uid(), tapped: false });
      this.addLog(`${isDM ? 'DM' : actor.name} plays a Land`);
      return { ok: true };
    }

    // cost adjustments (Anvil of the Deep, Salt Crystal, Philosopher's Stone, Truth)
    let cost = c.cost || 0;
    for (const u of this.board.filter(x => x.side === side && !this.isSuppressed(x))) {
      const uc = CARDS[u.cardId] || {};
      if (uc.costMod && ((uc.costMod.type === 'equip' && c.type === 'equip') || (uc.costMod.type === 'spell' && (c.type === 'spell' || c.type === 'reaction')))) cost += uc.costMod.delta;
      if (uc.truthAura) {
        if (c.type === 'spell' || c.type === 'reaction') cost = 1;
        if (c.type === 'creature') cost = Math.ceil((c.cost || 0) / 2);
      }
    }
    cost = Math.max(0, cost);
    if (payload.freePlay && this.isDM(pid)) cost = 0;

    if (!this.spendMana(side, cost)) return { err: `Not enough mana (need ${cost})` };

    // pay additional costs
    const ctx = {
      side, owner: pid, targets: payload.targets || [], gravePicks: payload.gravePicks || [],
      choice: payload.choice, kwChoice: payload.kwChoice, redirectTo: payload.redirectTo,
      targetPlayer: payload.targetPlayer, faceTarget: payload.faceTarget, deckChoice: payload.deckChoice,
      cardText: c.text, sacrificed: [], exiled: [],
      manaKind: (c.type === 'spell' || c.type === 'reaction') ? 'burst' : 'persist',
    };
    if (c.cost2) {
      const cc = c.cost2;
      const sacs = (payload.sacs || []).map(id => this.board.find(x => x.uid === id && x.side === side)).filter(Boolean);
      const need = cc.sac || 0;
      if (need && sacs.length < need) { this.refundMana(side, cost); return { err: `Must sacrifice ${need} creature(s)` }; }
      const useSacs = cc.sacUpTo ? sacs.slice(0, cc.sacUpTo) : sacs.slice(0, need);
      for (const s of useSacs) {
        if (cc.sacFilter && !this.matchFilter(s, cc.sacFilter)) continue;
        const st = this.stats(s);
        ctx.sacrificed.push({ cardId: s.cardId, atk: st.atk, hp: st.effHp });
        this.sacrifice(s);
      }
      if (cc.discard) {
        const ds = (payload.discards || []).slice(0, cc.discard);
        if (ds.length < cc.discard) { this.refundMana(side, cost); return { err: `Must discard ${cc.discard} card(s)` }; }
        for (const di of ds) {
          const i = hand.findIndex(h => h.inst === di && h.inst !== payload.inst);
          if (i >= 0) { const dc = hand.splice(i, 1)[0]; this.toGrave(side, { cardId: dc.cardId, name: (CARDS[dc.cardId] || {}).name }); this.addLog(`${isDM ? 'DM' : actor.name} discards ${(CARDS[dc.cardId] || {}).name}`); }
        }
      }
      if (cc.exile) {
        const g = this.graveFor(side);
        const exIdxs = (payload.exiles || []).slice(0, cc.exile).sort((a, b) => b - a);
        let exiled = 0;
        for (const gi of exIdxs) {
          if (gi >= 0 && gi < g.length) {
            const e = g[gi];
            const ec = CARDS[e.cardId] || {};
            if (cc.exileType === 'creature' && ec.type !== 'creature') continue;
            if (cc.exileType === 'spell' && !['spell', 'reaction'].includes(ec.type)) continue;
            if (cc.exileType === 'equip' && ec.type !== 'equip') continue;
            ctx.exiled.push(g.splice(gi, 1)[0]); this.exileFor(side).unshift(ctx.exiled[ctx.exiled.length - 1]);
            exiled++;
          }
        }
        if (exiled < cc.exile) { this.addLog(`Warning: only ${exiled}/${cc.exile} cards exiled (graveyard shortfall)`, 'system'); }
        else this.addLog(`Exiled ${exiled} card(s) from the graveyard`);
      }
      if (cc.loseHP) { if (side === 'party') this.shared.hp -= cc.loseHP; else this.dm.hp -= cc.loseHP; this.addLog(`${isDM ? 'DM' : 'Party'} pays ${cc.loseHP} HP`); this.checkEnd(); }
    }

    // remove from hand
    const handCard = hand.splice(hand.findIndex(h => h.inst === payload.inst), 1)[0];
    const who = isDM ? 'DM' : actor.name;
    this.addLog(`${who} plays ${c.name}${cost ? ` (${cost} mana)` : ''}`, 'play');

    if (c.type === 'creature' || c.type === 'tower' || c.type === 'persistent') {
      const u = this.makeUnit(cardId, side, pid, {});
      this.board.push(u);
      if (c.play && !c.manual) this.runActions(c.play, Object.assign({}, ctx, { self: u }));
      if (c.manual) this.addLog(`⚠ ${c.name}: "${c.text}" — resolve at the table (DM tools)`, 'manual');
      // allyAttack-style enters-play triggers on other cards (Withering Aura on DM side etc.)
      for (const other of this.board) {
        const oc = CARDS[other.cardId] || {};
        if (oc.enemyPlayed && other.side !== side && !this.isSuppressed(other)) this.runActions(oc.enemyPlayed, { side: other.side, self: other, owner: other.owner, subject: u });
      }
      this.checkDeaths();
      return { ok: true, unit: u.uid, reactionEvent: { kind: 'creaturePlayed', subject: u.uid, bySide: side } };
    }

    if (c.type === 'equip') {
      const target = this.board.find(x => x.uid === (payload.targets || [])[0]);
      if (!target || target.side !== side) { this.refundMana(side, cost); hand.splice(hi, 0, handCard); return { err: 'Equipment needs a friendly creature target' }; }
      const tc = CARDS[target.cardId] || {};
      let slots = tc.holds || 1;
      for (const other of this.board.filter(x => x.side === side)) {
        const oc = CARDS[other.cardId] || {};
        if (oc.holdsAura && other.uid !== target.uid && target.tribe && oc.holdsAura.scope === 'tribe:' + target.tribe) slots += oc.holdsAura.bonus;
      }
      if (target.equips.length >= slots) { this.refundMana(side, cost); hand.splice(hi, 0, handCard); return { err: 'That creature cannot hold more equipment' }; }
      const eq = { eid: uid(), cardId, name: c.name, a: c.equip.a || 0, h: c.equip.h || 0, kw: (c.equip.kw || []).slice(), breaks: c.equip.breaks, regen: c.equip.regen, manaGen: c.equip.manaGen, selfDmg: c.equip.selfDmg, hpDrain: c.equip.hpDrain, onKillDraw: c.equip.onKillDraw, onKillHeal: c.equip.onKillHeal };
      // Daedric Anvil bonus
      for (const other of this.board.filter(x => x.side === side)) {
        const oc = CARDS[other.cardId] || {};
        if (oc.equipAuraBonus) { eq.a += oc.equipAuraBonus.a || 0; if (oc.equipAuraBonus.loseHP) { this.shared.hp -= oc.equipAuraBonus.loseHP; this.addLog('Daedric Anvil drains 1 HP'); } }
      }
      if (c.equip.shield) target.shield += c.equip.shield;
      if (c.equip.onEquipLoseHP) { if (side === 'party') this.shared.hp -= c.equip.onEquipLoseHP; else this.dm.hp -= c.equip.onEquipLoseHP; this.checkEnd(); }
      target.equips.push(eq);
      this.addLog(`${target.name} is equipped with ${c.name}`);
      if (c.manualNote) this.addLog(`⚠ ${c.name}: ${c.manualNote}`, 'manual');
      return { ok: true };
    }

    // spell / reaction
    const spellCtx = Object.assign({}, ctx);
    const result = { ok: true, spell: true };
    if (isReaction) {
      if (c.play && !c.manual) this.runActions(c.play, Object.assign(spellCtx, { subject: this.reactionSubject() }));
      if (c.manual || c.manualNote) this.addLog(`⚠ ${c.name}: "${c.text}" — resolve at the table`, 'manual');
      this.toGrave(side, { cardId, name: c.name });
      this.afterSpell(side, pid);
      return result;
    }
    // spells resolve immediately unless a reaction window intercedes (handled by caller)
    result.pending = { kind: 'spell', cardId, side, pid, ctx: spellCtx, cost };
    return result;
  }

  reactionSubject() {
    if (this.pendingReaction && this.pendingReaction.subject) {
      const found = this.board.find(x => x.uid === this.pendingReaction.subject);
      if (found) return found;
    }
    return this.lastDeath || null;
  }

  resolveSpell(pending) {
    const c = CARDS[pending.cardId];
    if (this.pendingReaction && this.pendingReaction.negated) {
      this.addLog(`${c.name} is NEGATED!`, 'combat');
      this.toGrave(pending.side, { cardId: pending.cardId, name: c.name });
      if (this.pendingReaction.drainMana) this.spendMana(pending.side, c.cost || 0);
      return;
    }
    if (c.play && !c.manual) this.runActions(c.play, pending.ctx);
    if (c.manual || c.manualNote) this.addLog(`⚠ ${c.name}: "${c.manual ? c.text : c.manualNote}" — resolve at the table`, 'manual');
    this.toGrave(pending.side, { cardId: pending.cardId, name: c.name });
    this.afterSpell(pending.side, pending.pid);
  }

  afterSpell(side, pid) {
    // Azoth Flame etc: when you play a spell, draw
    for (const u of this.board.filter(x => x.side === side && !this.isSuppressed(x))) {
      const uc = CARDS[u.cardId] || {};
      if (uc.ownerSpell && u.owner === pid) this.runActions(uc.ownerSpell, { side, self: u, owner: u.owner });
    }
    this.checkDeaths();
  }

  sacrifice(u) {
    const idx = this.board.findIndex(x => x.uid === u.uid);
    if (idx < 0) return;
    this.totalSacrificed++;
    this.addLog(`${u.name} is sacrificed`, 'combat');
    const c = CARDS[u.cardId] || {};
    this.board.splice(idx, 1);
    for (const e of u.equips) this.toGrave(u.side, { cardId: e.cardId, name: e.name });
    if (!u.token) this.toGrave(u.side, { cardId: u.cardId, name: u.name, wasCreature: true });
    if (c.sacrificed && !this.isSuppressed(u)) this.runActions(c.sacrificed, { side: u.side, self: u, owner: u.owner });
    else if (c.death && !this.isSuppressed(u) && !u.suppressTriggers) this.runActions(c.death, { side: u.side, self: u, owner: u.owner }); // sacrifice triggers death effects
    for (const other of this.board) {
      const oc = CARDS[other.cardId] || {};
      if (oc.sacTrigger && other.side === u.side && !this.isSuppressed(other)) this.runActions(oc.sacTrigger, { side: other.side, self: other, owner: other.owner, subject: u });
      if (oc.allyDeath && other.side === u.side) {
        for (const a of oc.allyDeath) { if (a.ifTribe && u.tribe !== a.ifTribe) continue; this.act(a, { side: other.side, self: other, owner: other.owner, subject: u }); }
      }
    }
    this.checkDeaths();
  }

  // ---------- combat ----------
  declareAttack(pid, attackerUid, targetUid) {
    const u = this.board.find(x => x.uid === attackerUid);
    if (!u) return { err: 'No attacker' };
    const isDM = pid === 'dm';
    if (isDM ? u.side !== 'dm' : u.owner !== pid) return { err: 'Not your creature' };
    if (this.turn.current !== pid) return { err: 'Not your turn' };
    if (this.turn.phase !== 'attack' && this.turn.phase !== 'play') return { err: 'Attack during the Attack phase' };
    if (!this.canAttackNow(u)) return { err: 'This creature cannot attack right now' };
    const enemySide = u.side === 'party' ? 'dm' : 'party';
    // taunt validation
    const taunts = this.board.filter(x => x.side === enemySide && this.hasKw(x, 'taunt'));
    let target = targetUid === 'face' ? 'face' : this.board.find(x => x.uid === targetUid);
    if (targetUid !== 'face' && !target) return { err: 'No target' };
    if (taunts.length && (target === 'face' || !this.hasKw(target, 'taunt'))) return { err: 'Taunt creatures must be attacked first' };
    if (target !== 'face' && target.side === u.side) return { err: 'Cannot attack allies' };
    if (target !== 'face' && this.hasKw(target, 'noattack')) return { err: 'That creature cannot be targeted by attacks' };
    return { ok: true, pendingAttack: { attacker: attackerUid, target: targetUid, side: u.side } };
  }

  resolveAttack(pa) {
    const u = this.board.find(x => x.uid === pa.attacker);
    if (!u) return;
    let targetUid = (this.pendingReaction && this.pendingReaction.newTarget) || pa.target;
    u.attacksUsed++;
    const s = this.stats(u);
    const enemySide = u.side === 'party' ? 'dm' : 'party';
    // attack triggers
    const c = CARDS[u.cardId] || {};
    if (c.attack && !this.isSuppressed(u) && !u.suppressTriggers) this.runActions(c.attack, { side: u.side, self: u, owner: u.owner, subject: u, targets: [] });
    for (const other of this.board) {
      const oc = CARDS[other.cardId] || {};
      if (oc.allyAttack && other.side === u.side && other.uid !== u.uid && !this.isSuppressed(other)) this.runActions(oc.allyAttack, { side: other.side, self: other, owner: other.owner, subject: u });
      if (oc.enemyAttack && other.side !== u.side && !this.isSuppressed(other)) this.runActions(oc.enemyAttack, { side: other.side, self: other, owner: other.owner, attacker: u });
      if (other.retaliateOnEnemyAttack && other.side !== u.side) this.damageUnit(u, other.retaliateOnEnemyAttack, {});
    }
    if (!this.board.find(x => x.uid === u.uid)) return; // attacker died to triggers

    const atkNow = this.stats(u).atk;
    if (targetUid === 'face') {
      this.addLog(`${u.name} attacks ${enemySide === 'dm' ? 'the DM' : 'the party'} for ${atkNow}`, 'combat');
      this.damageFace(enemySide, atkNow, { attacker: u });
      if (this.hasKw(u, 'lifelink')) this.healFace(u.side, atkNow);
    } else {
      const d = this.board.find(x => x.uid === targetUid);
      if (!d) return;
      const ds = this.stats(d);
      this.addLog(`${u.name} (${atkNow}/${this.stats(u).effHp}) attacks ${d.name} (${ds.atk}/${ds.effHp})`, 'combat');
      const uFS = this.hasKw(u, 'firststrike'), dFS = this.hasKw(d, 'firststrike');
      const dealTo = (att, def, mult = 1) => {
        const a = this.stats(att).atk * ((CARDS[att.cardId] || {}).doubleVsTower && (def.type === 'tower' || def.type === 'persistent') ? 2 : 1);
        const defHpBefore = this.stats(def).effHp + def.shield;
        const dealt = this.damageUnit(def, a, { attacker: att, deathtouch: this.hasKw(att, 'deathtouch'), poison: this.kwVal(att, 'poison') || null, voidExile: this.hasKw(att, 'voidtouch') });
        if (this.hasKw(att, 'lifelink')) this.healFace(att.side, a);
        // trample overflow
        if (this.hasKw(att, 'trample') && a > defHpBefore) {
          const over = a - defHpBefore;
          this.addLog(`${att.name} tramples over for ${over}`, 'combat');
          this.damageFace(def.side, over, { attacker: att });
        }
        return dealt;
      };
      if (uFS && !dFS) {
        dealTo(u, d);
        const dAlive = this.board.find(x => x.uid === d.uid);
        if (dAlive && d.type === 'creature') dealTo(d, u);
      } else if (dFS && !uFS) {
        if (d.type === 'creature' && ds.atk > 0) dealTo(d, u);
        const uAlive = this.board.find(x => x.uid === u.uid);
        if (uAlive) dealTo(u, d);
      } else {
        // simultaneous
        const dAtk = d.type === 'creature' ? ds.atk : 0;
        dealTo(u, d);
        const uStill = this.board.find(x => x.uid === u.uid);
        if (dAtk > 0 && uStill) {
          const dealt = this.damageUnit(u, dAtk, { attacker: d, deathtouch: this.hasKw(d, 'deathtouch'), poison: this.kwVal(d, 'poison') || null });
          if (this.hasKw(d, 'lifelink')) this.healFace(d.side, dAtk);
        }
      }
      // kill tracking
      if (!this.board.find(x => x.uid === d.uid) && this.board.find(x => x.uid === u.uid)) {
        u.killCount++; u.killedThisTurn = true;
        const uc = CARDS[u.cardId] || {};
        if (uc.kill && !this.isSuppressed(u)) {
          for (const a of uc.kill) {
            if (a.everyN) { if (u.killCount % a.everyN === 0) this.act(a, { side: u.side, self: u, owner: u.owner }); }
            else this.act(a, { side: u.side, self: u, owner: u.owner });
          }
        }
        for (const e of u.equips) {
          if (e.onKillDraw) this.drawCards(u.owner, e.onKillDraw);
          if (e.onKillHeal) this.healFace(u.side, e.onKillHeal);
        }
        for (const other of this.board) {
          const oc = CARDS[other.cardId] || {};
          if (oc.allyKill && other.side === u.side && !this.isSuppressed(other)) {
            for (const a of oc.allyKill) this.act(a, { side: other.side, self: other, owner: other.owner, subject: u });
          }
        }
      }
      // equipment breakage
      const dAliveEnd = this.board.find(x => x.uid === d.uid);
      if (dAliveEnd) this.breakEquips(d, 'attacked');
    }
    const uAliveEnd = this.board.find(x => x.uid === u.uid);
    if (uAliveEnd) this.breakEquips(u, 'attack');
    this.checkDeaths();
  }

  breakEquips(u, when) {
    const broken = u.equips.filter(e => e.breaks === when);
    if (!broken.length) return;
    u.equips = u.equips.filter(e => e.breaks !== when);
    for (const e of broken) { this.toGrave(u.side, { cardId: e.cardId, name: e.name }); this.addLog(`${e.name} breaks!`, 'combat'); }
    this.checkDeaths();
  }

  // ---------- turn flow ----------
  startEncounter(opts = {}) {
    this.state = 'playing';
    const pids = Object.keys(this.players).filter(p => !this.players[p].isDM);
    const n = pids.length || 1;
    this.shared.maxHp = opts.partyHp || n * 8;
    this.shared.hp = this.shared.maxHp;
    this.dm.maxHp = opts.dmHp || n * 10;
    this.dm.hp = this.dm.maxHp;
    this.shared.manaPersist = 0; this.shared.manaBurst = 0;
    this.dm.mana = 0;
    this.board = []; this.grave = []; this.exilePile = []; this.dmGrave = []; this.dmExile = [];
    this.turn = { round: 1, current: null, phase: 'draw', acted: [], pickingNext: true };
    this.diedThisTurn = 0; this.diedLastRound = 0; this.totalSacrificed = 0;
    this.winner = null;
    // build decks
    for (const pid of pids) {
      const p = this.players[pid];
      const deckDef = p.decks.find(d => d.name === p.activeDeck) || p.decks[0];
      if (!deckDef) continue;
      p.deck = this.shuffle(deckDef.cards.slice());
      p.hand = []; p.lands = []; p.landsPlayed = 0; p.mulligans = 0;
      this.drawCards(pid, 4);
    }
    const dd = this.dm.decks.find(d => d.name === this.dm.activeDeck) || this.dm.decks[0];
    if (dd) this.dm.deck = this.shuffle(dd.cards.slice());
    else this.dm.deck = [];
    this.dm.hand = []; this.dm.lands = []; this.dm.landsPlayed = 0;
    this.drawCards('dm', 4);
    this.addLog(`Encounter started! Party HP ${this.shared.hp} · DM HP ${this.dm.hp}. Players: choose who goes first.`, 'system');
  }

  shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

  mulligan(pid) {
    const p = this.players[pid]; if (!p) return { err: 'no player' };
    if (this.turn.round > 1) return { err: 'Mulligans only before round 1 ends' };
    if (p.mulligans >= 2) return { err: 'Maximum 2 mulligans' };
    const n = p.hand.length;
    for (const h of p.hand) p.deck.push(h.cardId);
    p.hand = [];
    this.shuffle(p.deck);
    this.drawCards(pid, n);
    p.mulligans++;
    this.addLog(`${p.name} mulligans (${p.mulligans}/2)`);
    return { ok: true };
  }

  takeTurn(pid) {
    if (!this.turn.pickingNext) return { err: 'Not picking next player' };
    if (pid !== 'dm' && this.turn.acted.includes(pid)) return { err: 'Already acted this round' };
    this.turn.pickingNext = false;
    this.turn.current = pid;
    this.turn.phase = 'draw';
    const actor = pid === 'dm' ? this.dm : this.players[pid];
    actor.landsPlayed = 0;
    // untap own lands
    for (const l of actor.lands) l.tapped = false;
    const name = pid === 'dm' ? 'DM' : this.players[pid].name;
    this.addLog(`— ${name}'s turn (round ${this.turn.round}) —`, 'system');
    // draw
    const drawN = pid === 'dm' ? Object.keys(this.players).filter(p => !this.players[p].isDM).length : 1;
    const hand = actor.hand;
    if (pid !== 'dm' && hand.length >= 8) {
      this.turn.awaitDrawOrKeep = true;
      this.addLog(`${name} is at max hand size — draw or keep?`, 'system');
    } else {
      this.drawCards(pid, drawN);
    }
    // start-of-turn triggers for own units + equipment
    this.startTurnTriggers(pid);
    this.turn.phase = 'mana';
    return { ok: true };
  }

  startTurnTriggers(pid) {
    const side = pid === 'dm' ? 'dm' : 'party';
    for (const u of this.board.slice()) {
      if (!this.board.find(x => x.uid === u.uid)) continue;
      if (u.side !== side) continue;
      if (pid !== 'dm' && u.owner !== pid && u.owner !== undefined) {
        // party units trigger on their owner's turn only
        if (u.owner !== pid) continue;
      }
      if (u.suppressTriggers || this.isSuppressed(u)) continue;
      const c = CARDS[u.cardId] || {};
      if (c.startTurn) {
        for (const a of c.startTurn) {
          if ((a.t === 'enemy' || a.t === 'friendly' || a.t === 'creature') && !a.filter) {
            // needs a target — auto-pick best-effort (random enemy / random friendly)
            const auto = Object.assign({}, a, { t: a.t === 'enemy' ? 'randomEnemy' : 'randomFriendly' });
            this.act(auto, { side, self: u, owner: u.owner });
          } else this.act(a, { side, self: u, owner: u.owner, manaKind: 'persist' });
        }
      }
      for (const e of u.equips) {
        if (e.regen) { u.dmg = Math.max(0, u.dmg - e.regen); }
        if (e.manaGen) this.addMana(side, e.manaGen, 'persist');
        if (e.selfDmg) this.damageUnit(u, e.selfDmg, {});
        if (e.hpDrain) { if (side === 'party') { this.shared.hp -= e.hpDrain; this.addLog(`${e.name} drains ${e.hpDrain} player HP`); this.checkEnd(); } }
      }
    }
  }

  drawOrKeep(pid, choice) {
    if (!this.turn.awaitDrawOrKeep || this.turn.current !== pid) return { err: 'no prompt' };
    this.turn.awaitDrawOrKeep = false;
    if (choice === 'draw') { this.drawCards(pid, 1); return { ok: true, mustDiscardTo: 8 }; }
    this.addLog(`${this.players[pid].name} keeps their hand`);
    return { ok: true };
  }

  discardCard(pid, inst) {
    const p = this.players[pid]; if (!p) return { err: 'no player' };
    const i = p.hand.findIndex(h => h.inst === inst);
    if (i < 0) return { err: 'not in hand' };
    const c = p.hand.splice(i, 1)[0];
    this.toGrave('party', { cardId: c.cardId, name: (CARDS[c.cardId] || {}).name });
    this.addLog(`${p.name} discards ${(CARDS[c.cardId] || {}).name}`);
    return { ok: true };
  }

  nextPhase(pid) {
    if (this.turn.current !== pid && !this.isDM(pid)) return { err: 'Not your turn' };
    const order = ['draw', 'mana', 'play', 'attack', 'resolution'];
    const i = order.indexOf(this.turn.phase);
    if (i < order.length - 1) { this.turn.phase = order[i + 1]; this.addLog(`Phase: ${this.turn.phase}`); return { ok: true }; }
    return this.endTurn(pid);
  }

  tapLand(pid, landId) {
    const actor = pid === 'dm' ? this.dm : this.players[pid];
    if (!actor) return { err: 'no' };
    const l = actor.lands.find(x => x.id === landId);
    if (!l || l.tapped) return { err: 'Land unavailable' };
    l.tapped = true;
    this.addMana(pid === 'dm' ? 'dm' : 'party', 1, 'persist');
    return { ok: true };
  }

  endTurn(pid) {
    if (this.turn.current !== pid && !this.isDM(pid)) return { err: 'Not your turn' };
    const cur = this.turn.current;
    const side = cur === 'dm' ? 'dm' : 'party';
    // end-of-turn scheduled effects
    for (const fx of (this.turnFx || [])) {
      if (fx.when !== 'endTurn') continue;
      const units = fx.uids ? fx.uids.map(id => this.board.find(x => x.uid === id)).filter(Boolean) : [];
      for (const u of units) {
        if (fx.dmg) this.damageUnit(u, fx.dmg, {});
        if (fx.destroy) this.die(u);
      }
    }
    this.turnFx = [];
    // poison ticks (units owned by the current turn's side/owner)
    for (const u of this.board.slice()) {
      const mine = cur === 'dm' ? u.side === 'dm' : u.owner === cur;
      if (!mine || !u.poison.length) continue;
      for (const p of u.poison) { this.addLog(`${u.name} suffers ${p.x} poison damage`, 'combat'); this.damageUnit(u, p.x, {}); p.rounds--; }
      u.poison = u.poison.filter(p => p.rounds > 0);
    }
    // temp unit expiry + turn buff expiry for current side's units
    for (const u of this.board.slice()) {
      const mine = cur === 'dm' ? u.side === 'dm' : u.owner === cur;
      if (!mine) continue;
      if (u.tempTurns > 0) {
        u.tempTurns--;
        if (u.tempTurns === 0) { this.addLog(`${u.name} expires`); if (u.exileOnDeath) this.die(u); else this.die(u); continue; }
      }
      this.breakEquips(u, 'endTurn');
    }
    for (const u of this.board) {
      const mine = cur === 'dm' ? u.side === 'dm' : u.owner === cur;
      if (!mine) continue;
      u.turnBuffs = u.turnBuffs.map(b => ({ ...b, expires: b.expires - 1 })).filter(b => b.expires > 0);
      u.kwTemp = u.kwTemp.map(k => ({ ...k, expires: k.expires - 1 })).filter(k => k.expires > 0);
      u.kwRemovedTurn = null;
      if (typeof u.suppressed === 'number' && u.suppressed > 0) u.suppressed--;
      if (u.cantAttack > 0) u.cantAttack--;
      u.attacksUsed = 0; u.rezHaste = false; u.killedThisTurn = false; u.usedAbility = false;
    }
    this.checkDeaths();
    // burst mana expires
    if (this.shared.manaBurst > 0) { this.addLog(`${this.shared.manaBurst} burst mana expires`); this.shared.manaBurst = 0; }
    const name = cur === 'dm' ? 'DM' : (this.players[cur] || {}).name;
    this.addLog(`${name} ends their turn`);

    if (cur === 'dm') {
      // new round
      this.turn.round++;
      this.turn.acted = [];
      this.diedLastRound = this.diedThisTurn;
      this.diedThisTurn = 0;
      this.turn.current = null;
      this.turn.pickingNext = true;
      this.addLog(`— Round ${this.turn.round} — players choose who goes first`, 'system');
    } else {
      this.turn.acted.push(cur);
      const remaining = Object.keys(this.players).filter(p => !this.players[p].isDM && !this.turn.acted.includes(p) && this.players[p].connected !== 'kicked');
      if (remaining.length === 0) {
        // DM turn
        this.turn.current = null;
        this.turn.pickingNext = false;
        this.takeDMTurn();
      } else if (remaining.length === 1) {
        this.turn.pickingNext = false;
        this.takeTurnAuto(remaining[0]);
      } else {
        this.turn.current = cur; // ending player picks next
        this.turn.pickingNext = 'byCurrent';
      }
    }
    return { ok: true };
  }

  takeTurnAuto(pid) { this.turn.pickingNext = true; this.takeTurn(pid); }

  passTo(pid, nextPid) {
    if (this.turn.pickingNext !== 'byCurrent' || this.turn.current !== pid) return { err: 'Not picking' };
    if (this.turn.acted.includes(nextPid)) return { err: 'They already acted' };
    this.turn.pickingNext = true;
    return this.takeTurn(nextPid);
  }

  takeDMTurn() {
    this.turn.pickingNext = true;
    this.takeTurn('dm');
  }

  // ---------- activated abilities ----------
  activate(pid, unitUid, payload = {}) {
    const u = this.board.find(x => x.uid === unitUid);
    if (!u) return { err: 'No unit' };
    if (pid !== 'dm' && u.owner !== pid) return { err: 'Not yours' };
    const c = CARDS[u.cardId] || {};
    if (!c.activated) return { err: 'No ability' };
    if (this.isSuppressed(u)) return { err: 'Abilities suppressed' };
    if (c.activated.oncePerTurn && u.usedAbility) return { err: 'Already used this turn' };
    if (c.activated.once && u.usedOnce) return { err: 'Already used' };
    const ctx = { side: u.side, owner: u.owner, self: u, targets: payload.targets || [], gravePicks: payload.gravePicks || [], sacrificed: [], exiled: [] };
    const cost = c.activated.cost || {};
    if (cost.sac) {
      const sacs = (payload.sacs || []).map(id => this.board.find(x => x.uid === id && x.side === u.side && x.uid !== u.uid)).filter(Boolean);
      if (sacs.length < cost.sac) return { err: `Sacrifice ${cost.sac} creature(s)` };
      for (const s of sacs.slice(0, cost.sac)) { const st = this.stats(s); ctx.sacrificed.push({ cardId: s.cardId, atk: st.atk, hp: st.effHp }); this.sacrifice(s); }
    }
    if (cost.exile) {
      const g = this.graveFor(u.side);
      if (g.length < cost.exile) return { err: 'Not enough cards in graveyard' };
      for (let i = 0; i < cost.exile; i++) this.exileFor(u.side).unshift(g.shift());
    }
    if (cost.loseHP) { if (u.side === 'party') this.shared.hp -= cost.loseHP; else this.dm.hp -= cost.loseHP; this.checkEnd(); }
    if (c.activated.sacSelf) { this.sacrifice(u); }
    u.usedAbility = true; u.usedOnce = true;
    this.addLog(`${u.name}: ${c.activated.name}`);
    this.runActions(c.activated.actions, ctx);
    if (c.activated.sacSelfExile) { /* handled by exile action */ }
    return { ok: true };
  }
}

module.exports = { Game, CARDS, uid };
