// game.js — authoritative game state + rules engine for one encounter.
// All mutable state lives in `this.s` (a plain, structured-clonable object) so
// the whole game can be snapshotted for undo/rewind.
import { getCard } from './cards.js';
import * as effects from './effects.js';

const PHASES = ['draw', 'mana', 'play', 'attack', 'resolution'];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class GameState {
  // setup = { players:[{id,name,class,archetype,deckCardIds:[...]}],
  //           dmDeckCardIds:[...], partyHP, dmHP, difficulty }
  constructor(setup) {
    this.history = [];           // snapshot stack (not part of s)
    this.future = [];            // redo stack
    const s = {
      round: 1,
      phase: 'play',
      activeId: setup.players[0]?.id || null,
      isDM: false,
      taken: [],
      order: setup.players.map((p) => p.id),
      partyHP: setup.partyHP, partyHPMax: setup.partyHP, partyShield: 0,
      dmHP: setup.dmHP, dmHPMax: setup.dmHP, dmShield: 0,
      mana: { available: 0, burst: 0 },
      dmMana: { available: 0, burst: 0 },
      board: [],
      graveyard: [],
      exile: [],
      hands: {},
      decks: {},
      dmHand: [],
      dmDeck: [],
      players: setup.players.map((p) => ({ id: p.id, name: p.name, class: p.class, archetype: p.archetype })),
      mulligans: {},
      log: [],
      winner: null,
      nextId: 1,
      difficulty: setup.difficulty || 'Medium',
      suppressed: [],            // instIds whose triggers DM suppressed
    };
    this.s = s;
    for (const p of setup.players) {
      s.decks[p.id] = shuffle((p.deckCardIds || []).map((cid) => this._inst(cid, p.id)));
      s.hands[p.id] = [];
      s.mulligans[p.id] = 0;
      this._draw(p.id, 7);
    }
    s.dmDeck = shuffle((setup.dmDeckCardIds || []).map((cid) => this._inst(cid, 'dm')));
    this._draw('dm', Math.max(3, s.players.length));
    this.log(`Encounter begins — Party ${s.partyHP} HP vs DM ${s.dmHP} HP (${s.difficulty}).`, 'system');
  }

  // ---- helpers ----
  _id() { return 'e' + (this.s.nextId++); }
  _inst(cardId, owner) { return { instId: this._id(), cardId, owner }; }
  log(msg, type = 'info', meta = null) {
    this.s.log.push({ t: Date.now(), msg, type, meta });
    if (this.s.log.length > 500) this.s.log.shift();
  }
  card(cid) { return getCard(cid); }
  ent(instId) { return this.s.board.find((e) => e.instId === instId) || this._findEquip(instId); }
  _findEquip(instId) {
    for (const e of this.s.board) {
      const eq = (e.equipment || []).find((q) => q.instId === instId);
      if (eq) return eq;
    }
    return null;
  }
  handOf(pid) { return pid === 'dm' ? this.s.dmHand : (this.s.hands[pid] || []); }
  deckOf(pid) { return pid === 'dm' ? this.s.dmDeck : (this.s.decks[pid] || []); }
  sideOf(pid) { return pid === 'dm' ? 'dm' : 'party'; }
  manaOf(side) { return side === 'dm' ? this.s.dmMana : this.s.mana; }

  snapshot() {
    this.history.push(structuredClone(this.s));
    if (this.history.length > 60) this.history.shift();
    this.future = [];
  }
  undo() {
    if (!this.history.length) return false;
    this.future.push(structuredClone(this.s));
    this.s = this.history.pop();
    this.log('DM undid the last action.', 'dm');
    return true;
  }
  redo() {
    if (!this.future.length) return false;
    this.history.push(structuredClone(this.s));
    this.s = this.future.pop();
    this.log('DM redid an action.', 'dm');
    return true;
  }

  // ---- card movement / draw ----
  _draw(pid, n = 1) {
    const deck = this.deckOf(pid);
    const hand = this.handOf(pid);
    const drawn = [];
    for (let i = 0; i < n; i++) {
      if (!deck.length) { this.log(`${this._name(pid)} has no cards left to draw (deck out).`, 'system'); break; }
      const inst = deck.shift();
      hand.push(inst);
      drawn.push(inst);
    }
    return drawn;
  }
  drawFor(pid, n) {
    if (!pid) return;
    const drawn = this._draw(pid, n);
    if (drawn.length) this.log(`${this._name(pid)} draws ${drawn.length} card(s).`, 'info');
  }
  _name(pid) {
    if (pid === 'dm') return 'DM';
    const p = this.s.players.find((x) => x.id === pid);
    return p ? p.name : 'Player';
  }

  mulligan(pid) {
    if ((this.s.mulligans[pid] || 0) >= 2) return { error: 'Max 2 mulligans.' };
    this.snapshot();
    const hand = this.handOf(pid);
    const deck = this.deckOf(pid);
    while (hand.length) deck.push(hand.pop());
    shuffle(deck);
    this.s.mulligans[pid] = (this.s.mulligans[pid] || 0) + 1;
    this._draw(pid, 7);
    this.log(`${this._name(pid)} mulligans (#${this.s.mulligans[pid]}).`, 'info');
    return { ok: true };
  }

  // ---- entities ----
  _makeEntity(card, side, owner, opts = {}) {
    const kws = [...(card.keywords || [])].filter((k) => !/^(Shield|Poison)\s/.test(k));
    let shield = 0;
    const sh = (card.keywords || []).find((k) => /^Shield\s/.test(k));
    if (sh) shield = parseInt(sh.split(' ')[1], 10) || 0;
    const e = {
      instId: this._id(),
      cardId: card.id,
      name: card.name,
      side, owner,
      type: card.type,
      baseAttack: card.attack ?? 0,
      attack: (card.attack ?? 0) + (opts.attackMod || 0),
      maxHealth: (card.health ?? 1) + (opts.healthMod || 0),
      health: (card.health ?? 1) + (opts.healthMod || 0),
      shield,
      keywords: kws,
      tempKeywords: [],          // [{kw, duration}]
      buffs: [],                 // [{a,h,duration}]
      equipment: [],
      tapped: false,
      summonedRound: this.s.round,
      attacksThisTurn: 0,
      cannotAttackTurns: 0,
      poison: [],                // [{amount, turns}]
      isToken: !!opts.isToken,
      manaGen: card.type === 'land' ? 1 : 0,
      equipSlots: this._equipSlots(card),
    };
    return e;
  }
  _equipSlots(card) {
    if (/can hold 3 equipment/i.test(card.text || '')) return 3;
    if (/can hold 2 equipment/i.test(card.text || '')) return 2;
    return 1;
  }

  // ---- mana ----
  untapFor(side) {
    const owner = this.s.activeId;
    for (const e of this.s.board) {
      if (e.side === side && (side === 'dm' || e.owner === owner)) e.tapped = false;
    }
  }
  collectMana(side) {
    // tap all untapped lands of the active controller, +manaGen each.
    const owner = this.s.activeId;
    let gained = 0;
    for (const e of this.s.board) {
      if (e.type !== 'land') continue;
      if (e.side !== side) continue;
      if (side !== 'dm' && e.owner !== owner) continue;
      if (!e.tapped) { e.tapped = true; gained += e.manaGen || 1; }
    }
    if (gained) { this.manaOf(side).available += gained; this.log(`${this._name(this.s.activeId)} taps lands for ${gained} mana.`, 'info'); }
    return gained;
  }
  tapLand(instId) {
    const e = this.ent(instId);
    if (!e || e.type !== 'land' || e.tapped) return { error: 'Cannot tap.' };
    this.snapshot();
    e.tapped = true;
    this.manaOf(e.side).available += e.manaGen || 1;
    this.log(`${e.name} tapped for ${e.manaGen || 1} mana.`, 'info');
    return { ok: true };
  }
  addMana(amount, burst = false) {
    const m = this.manaOf(this.sideOf(this.s.activeId));
    if (burst) m.burst += amount; else m.available += amount;
    this.log(`+${amount} ${burst ? 'burst ' : ''}mana.`, 'info');
  }
  _spend(side, cost) {
    const m = this.manaOf(side);
    if (m.available + m.burst < cost) return false;
    let rem = cost;
    const fromBurst = Math.min(m.burst, rem); m.burst -= fromBurst; rem -= fromBurst;
    m.available -= rem;
    return true;
  }

  // ---- facade methods used by effects.js ----
  damageTarget(instId, amount, ctx) {
    if (instId === 'dmFace') return this.damageFace('dm', amount);
    if (instId === 'partyFace') return this.damageFace('party', amount);
    const e = this.ent(instId);
    if (e) this._damageEntity(e, amount, null);
  }
  damageAll(side, amount) {
    for (const e of [...this.s.board]) if (e.side === side && e.type !== 'land') this._damageEntity(e, amount, null);
  }
  damageFace(side, amount) {
    if (side === 'dm') {
      const a = Math.max(0, amount - this.s.dmShield); this.s.dmShield = Math.max(0, this.s.dmShield - amount);
      this.s.dmHP -= a; this.log(`DM takes ${a} damage (HP ${this.s.dmHP}).`, 'damage');
    } else {
      const a = Math.max(0, amount - this.s.partyShield); this.s.partyShield = Math.max(0, this.s.partyShield - amount);
      this.s.partyHP -= a; this.log(`Party takes ${a} damage (HP ${this.s.partyHP}).`, 'damage');
    }
    this._checkWin();
  }
  healParty(amount) {
    this.s.partyHP = Math.min(this.s.partyHPMax, this.s.partyHP + amount);
    this.log(`Party restores ${amount} HP (HP ${this.s.partyHP}).`, 'heal');
  }
  healCreature(instId, amount) {
    const e = this.ent(instId);
    if (!e) return;
    e.health = Math.min(e.maxHealth, e.health + amount);
    this.log(`${e.name} restores ${amount} health.`, 'heal');
  }
  addPartyShield(amount) { this.s.partyShield += amount; this.log(`Party gains ${amount} shield.`, 'info'); }
  buffSide(side, a, h, duration) {
    for (const e of this.s.board) if (e.side === side && e.type !== 'land') this._applyBuff(e, a, h, duration);
  }
  buffCreature(instId, a, h, duration) { const e = this.ent(instId); if (e) this._applyBuff(e, a, h, duration); }
  _applyBuff(e, a, h, duration) {
    e.attack += a; e.health += h; e.maxHealth += h;
    if (duration !== 'permanent') e.buffs.push({ a, h, duration: 'turn' });
    if (e.health <= 0) this._die(e, null);
  }
  grantKeyword(instId, kw, duration) {
    const e = this.ent(instId); if (!e) return;
    if (duration === 'permanent') { if (!e.keywords.includes(kw)) e.keywords.push(kw); }
    else e.tempKeywords.push({ kw, duration: 'turn' });
    this.log(`${e.name} gains ${kw}${duration === 'permanent' ? ' permanently' : ' this turn'}.`, 'info');
  }
  poisonCreature(instId, amount) { const e = this.ent(instId); if (e) { e.poison.push({ amount, turns: 3 }); this.log(`${e.name} is poisoned (${amount}).`, 'info'); } }
  poisonSide(side, amount) { for (const e of this.s.board) if (e.side === side && e.type !== 'land') e.poison.push({ amount, turns: 3 }); }
  createTokens(side, count, attack, health, keywords = []) {
    const owner = side === 'dm' ? 'dm' : this.s.activeId;
    for (let i = 0; i < count; i++) {
      const e = {
        instId: this._id(), cardId: null, name: `${attack}/${health} Token`, side, owner,
        type: 'creature', baseAttack: attack, attack, maxHealth: health, health, shield: 0,
        keywords: [...keywords], tempKeywords: [], buffs: [], equipment: [], tapped: false,
        summonedRound: this.s.round, attacksThisTurn: 0, cannotAttackTurns: 0, poison: [],
        isToken: true, manaGen: 0, equipSlots: 1,
      };
      this.s.board.push(e);
    }
    this.log(`${this._name(owner)} creates ${count} ${attack}/${health} token(s).`, 'info');
  }

  // ---- playing cards ----
  hasKeyword(e, kw) { return e.keywords.includes(kw) || e.tempKeywords.some((t) => t.kw === kw); }

  playCard(pid, instId, opts = {}) {
    const hand = this.handOf(pid);
    const i = hand.findIndex((c) => c.instId === instId);
    if (i < 0) return { error: 'Card not in hand.' };
    const inst = hand[i];
    const card = this.card(inst.cardId);
    if (!card) return { error: 'Unknown card.' };
    const side = this.sideOf(pid);
    const free = !!opts.free;
    const cost = card.cost || 0;

    if (!free && card.type !== 'land') {
      if (!this._spend(side, cost)) return { error: 'Not enough mana.' };
    }
    this.snapshot();
    hand.splice(i, 1);

    const info = effects.analyze(card);
    const ctx = { playerId: pid, side, targets: opts.targets || [] };

    if (card.type === 'land') {
      const e = this._makeEntity(card, side, pid);
      this.s.board.push(e);
      this.log(`${this._name(pid)} plays ${card.name}.`, 'play');
    } else if (card.type === 'equipment') {
      const target = opts.targets && opts.targets[0];
      const host = target && this.ent(target);
      if (!host) { this._toGrave(inst); this.log(`${card.name} played but had no creature to equip — sent to graveyard.`, 'play'); }
      else { this._equip(host, card, inst); this.log(`${this._name(pid)} equips ${card.name} to ${host.name}.`, 'play'); }
    } else if (card.type === 'creature' || card.type === 'tower' || card.type === 'persistent') {
      const e = this._makeEntity(card, side, pid);
      this.s.board.push(e);
      this.log(`${this._name(pid)} plays ${card.name} (${e.attack}/${e.health}).`, 'play');
      // on-play automated effects (buffs/tokens/damage/draw etc.)
      if (!this.s.suppressed.includes(card.id)) effects.apply(this, card, ctx, info);
      if (info.manual) this.log(`↳ ${card.name}: "${card.text}" — resolve manually (DM).`, 'manual', { instId: e.instId });
    } else {
      // spell
      this.log(`${this._name(pid)} casts ${card.name}.`, 'play');
      effects.apply(this, card, ctx, info);
      if (info.manual) this.log(`↳ ${card.name}: "${card.text}" — resolve manually (DM).`, 'manual');
      this._toGrave(inst);
    }
    this._cleanupDeaths();
    this._checkWin();
    return { ok: true, info };
  }

  _equip(host, card, inst) {
    const text = (card.text || '').toLowerCase();
    let aMod = 0, hMod = 0;
    let m;
    if ((m = text.match(/\+(\d+)\s*attack/))) aMod += +m[1];
    if ((m = text.match(/\+(\d+)\s*health/))) hMod += +m[1];
    const eq = { instId: inst.instId, cardId: card.id, name: card.name, aMod, hMod, keywords: [] };
    for (const kw of ['Haste', 'Trample', 'Deathtouch', 'Lifelink', 'First Strike', 'Taunt']) {
      if (new RegExp('gains ' + kw, 'i').test(card.text || '')) eq.keywords.push(kw);
    }
    const sh = (card.text || '').match(/Shield\s+(\d+)/i);
    if (sh) host.shield += parseInt(sh[1], 10);
    host.equipment.push(eq);
    host.attack += aMod; host.health += hMod; host.maxHealth += hMod;
    for (const kw of eq.keywords) if (!host.keywords.includes(kw)) host.keywords.push(kw);
  }

  _toGrave(inst) {
    if (inst.cardId) this.s.graveyard.push({ instId: inst.instId, cardId: inst.cardId, owner: inst.owner });
  }

  // ---- combat ----
  declareAttack(pid, attackerId, targetId) {
    const attacker = this.ent(attackerId);
    if (!attacker) return { error: 'No attacker.' };
    if (attacker.side !== this.sideOf(pid) && pid !== 'dm') return { error: 'Not your creature.' };
    if (attacker.type === 'land' || attacker.type === 'tower') return { error: 'This cannot attack.' };
    if (attacker.attack <= 0) return { error: 'Zero attack.' };
    const maxAtk = this.hasKeyword(attacker, 'Haste') ? 2 : 1;
    if (attacker.attacksThisTurn >= maxAtk) return { error: 'Already attacked.' };
    if (attacker.cannotAttackTurns > 0) return { error: 'Cannot attack (frozen).' };
    const summonSick = attacker.summonedRound >= this.s.round && !this.hasKeyword(attacker, 'Haste') && attacker.attacksThisTurn === 0 && attacker._hasted !== true;
    // allow attack if not summon sick OR haste; for simplicity, creatures summoned a previous round always ok
    if (attacker.summonedRound >= this.s.round && !this.hasKeyword(attacker, 'Haste')) {
      return { error: 'Summoning sickness (needs Haste to attack this turn).' };
    }
    const enemy = attacker.side === 'party' ? 'dm' : 'party';

    // Taunt enforcement
    const taunts = this.s.board.filter((e) => e.side === enemy && this.hasKeyword(e, 'Taunt') && e.health > 0 && e.type !== 'land');
    if (targetId !== 'face') {
      const target = this.ent(targetId);
      if (!target) return { error: 'No target.' };
      if (taunts.length && !this.hasKeyword(target, 'Taunt')) return { error: 'Must attack a Taunt creature first.' };
    } else if (taunts.length) {
      return { error: 'Must attack a Taunt creature first.' };
    }

    this.snapshot();
    attacker.attacksThisTurn += 1;
    if (targetId === 'face') return this._resolveFaceAttack(attacker, enemy);
    return this._resolveCreatureCombat(attacker, this.ent(targetId));
  }

  _resolveFaceAttack(attacker, enemy) {
    const dmg = attacker.attack;
    this.damageFace(enemy, dmg);
    if (this.hasKeyword(attacker, 'Lifelink')) {
      if (attacker.side === 'party') this.healParty(dmg); else { this.s.dmHP = Math.min(this.s.dmHPMax, this.s.dmHP + dmg); }
    }
    this.log(`${attacker.name} attacks ${enemy === 'dm' ? 'the DM' : 'the party'} for ${dmg}.`, 'combat');
    return { ok: true };
  }

  _resolveCreatureCombat(attacker, defender) {
    if (!defender) return { error: 'No defender.' };
    const aFS = this.hasKeyword(attacker, 'First Strike');
    const dFS = this.hasKeyword(defender, 'First Strike');
    this.log(`${attacker.name} (${attacker.attack}/${attacker.health}) attacks ${defender.name} (${defender.attack}/${defender.health}).`, 'combat');

    const dealCombat = (src, dst, isAttacker) => {
      const lethalBefore = dst.health;
      const overflow = this._damageEntity(dst, src.attack, src);
      if (this.hasKeyword(src, 'Lifelink')) {
        const healed = src.attack;
        if (src.side === 'party') this.healParty(healed); else this.s.dmHP = Math.min(this.s.dmHPMax, this.s.dmHP + healed);
      }
      if (isAttacker && this.hasKeyword(src, 'Trample') && overflow > 0) {
        const enemy = src.side === 'party' ? 'dm' : 'party';
        this.damageFace(enemy, overflow);
        this.log(`${src.name} tramples ${overflow} over.`, 'combat');
      }
      return lethalBefore;
    };

    if (aFS && !dFS) {
      dealCombat(attacker, defender, true);
      if (defender.health > 0) dealCombat(defender, attacker, false);
    } else if (dFS && !aFS) {
      dealCombat(defender, attacker, false);
      if (attacker.health > 0) dealCombat(attacker, defender, true);
    } else {
      // simultaneous
      const aAtk = attacker.attack, dAtk = defender.attack;
      const overflow = this._damageEntity(defender, aAtk, attacker);
      this._damageEntity(attacker, dAtk, defender);
      if (this.hasKeyword(attacker, 'Lifelink')) { if (attacker.side === 'party') this.healParty(aAtk); else this.s.dmHP = Math.min(this.s.dmHPMax, this.s.dmHP + aAtk); }
      if (this.hasKeyword(defender, 'Lifelink')) { if (defender.side === 'party') this.healParty(dAtk); else this.s.dmHP = Math.min(this.s.dmHPMax, this.s.dmHP + dAtk); }
      if (this.hasKeyword(attacker, 'Trample') && overflow > 0) {
        const enemy = attacker.side === 'party' ? 'dm' : 'party';
        this.damageFace(enemy, overflow);
      }
    }
    this._cleanupDeaths();
    this._checkWin();
    return { ok: true };
  }

  // returns overflow damage (for trample). Applies deathtouch.
  _damageEntity(e, amount, src) {
    if (amount <= 0) return 0;
    let dmg = amount;
    const absorbed = Math.min(e.shield, dmg);
    e.shield -= absorbed; dmg -= absorbed;
    const dealt = Math.min(e.health, dmg);
    e.health -= dmg;
    if (src && this.hasKeyword(src, 'Deathtouch') && dealt > 0) e.health = Math.min(e.health, 0);
    const overflow = Math.max(0, dmg - dealt);
    if (e.health <= 0) this._markDead(e);
    return overflow;
  }

  _markDead(e) { e._dead = true; }
  _cleanupDeaths() {
    const dead = this.s.board.filter((e) => e._dead || (e.type !== 'land' && e.health <= 0 && e.type !== 'persistent') || (e.health <= 0));
    for (const e of dead) this._die(e, null);
  }
  _die(e, killer) {
    const idx = this.s.board.indexOf(e);
    if (idx < 0) return;
    this.s.board.splice(idx, 1);
    // equipment destroyed with creature
    for (const eq of e.equipment || []) {
      this.s.graveyard.push({ instId: eq.instId, cardId: eq.cardId, owner: e.owner });
    }
    if (!e.isToken && e.cardId) this.s.graveyard.push({ instId: e.instId, cardId: e.cardId, owner: e.owner });
    this.log(`${e.name} dies.`, 'death', { side: e.side });
  }

  // ---- start / end of turn automation ----
  processStartOfTurn(side) {
    const owner = this.s.activeId;
    for (const e of [...this.s.board]) {
      if (e.side !== side) continue;
      if (side !== 'dm' && e.owner !== owner) continue;
      const t = (this.card(e.cardId)?.text || '').toLowerCase();
      if (!t || this.s.suppressed.includes(e.cardId)) continue;
      let m;
      if (/at start of (your|the) turn/.test(t) || /at start of turn/.test(t)) {
        if ((m = t.match(/add (\d+) mana/))) { this.manaOf(side).available += +m[1]; this.log(`${e.name}: +${m[1]} mana.`, 'info'); }
        if ((m = t.match(/restore (\d+) player hp/))) this.healParty(+m[1]);
        if ((m = t.match(/restore (\d+) health to all friendly creatures/))) this.buffSideHeal(side, +m[1]);
        if ((m = t.match(/generate (\d+) player shield/))) this.addPartyShield(+m[1]);
        if ((m = t.match(/create a (\d+)\/(\d+)[^.]*token/))) this.createTokens(side, 1, +m[1], +m[2], []);
        if ((m = t.match(/deal (\d+) damage to all enemy creatures/))) this.damageAll(side === 'party' ? 'dm' : 'party', +m[1]);
      }
    }
  }
  buffSideHeal(side, amount) {
    for (const e of this.s.board) if (e.side === side && e.type !== 'land') e.health = Math.min(e.maxHealth, e.health + amount);
  }
  processEndOfTurnPoison(side) {
    const owner = this.s.activeId;
    for (const e of [...this.s.board]) {
      if (e.side !== side) continue;
      if (!e.poison || !e.poison.length) continue;
      let total = 0;
      for (const p of e.poison) { total += p.amount; p.turns -= 1; }
      e.poison = e.poison.filter((p) => p.turns > 0);
      if (total) this._damageEntity(e, total, null);
      if (total) this.log(`${e.name} takes ${total} poison damage.`, 'damage');
    }
    this._cleanupDeaths();
  }

  // ---- turn structure ----
  setPhase(phase) {
    if (!PHASES.includes(phase)) return { error: 'Bad phase.' };
    this.snapshot();
    this.s.phase = phase;
    this.log(`Phase → ${phase}.`, 'system');
    return { ok: true };
  }
  nextPhase() {
    const i = PHASES.indexOf(this.s.phase);
    if (i < 0 || i === PHASES.length - 1) return this.setPhase('resolution');
    return this.setPhase(PHASES[i + 1]);
  }

  beginTurn(pid) {
    this.s.activeId = pid;
    this.s.isDM = pid === 'dm';
    this.s.phase = 'draw';
    const side = this.sideOf(pid);
    this.untapFor(side);
    // clear summon sickness happens implicitly via round comparison
    this.log(`— ${this._name(pid)}'s turn (round ${this.s.round}) —`, 'system');
    this._draw(pid, 1);
    this.s.phase = 'mana';
    this.collectMana(side);
    this.processStartOfTurn(side);
    this.s.phase = 'play';
  }

  endTurn(nextId) {
    this.snapshot();
    const side = this.sideOf(this.s.activeId);
    this.processEndOfTurnPoison(side);
    // expire "this turn" buffs/keywords on the active side
    this._expireTurn(side);
    // clear burst mana for the side
    this.manaOf(side).burst = 0;
    // reset attacks for the side
    for (const e of this.s.board) if (e.side === side) { e.attacksThisTurn = 0; if (e.cannotAttackTurns > 0) e.cannotAttackTurns--; }
    // The DM finishing their turn always begins a NEW ROUND with a player.
    // (Checked first so a DM-chosen nextId of 'dm' doesn't restart the DM turn.)
    if (this.s.activeId === 'dm') {
      this.s.round += 1;
      this.s.taken = [];
      const first = (nextId && nextId !== 'dm') ? nextId : this.s.order[0];
      this.beginTurn(first);
      return { ok: true };
    }

    // A player finished their turn.
    this.s.taken.push(this.s.activeId);
    if (nextId === 'dm' || this.s.taken.length >= this.s.players.length) {
      this.beginTurn('dm');
      return { ok: true };
    }
    let next = nextId;
    if (!next || this.s.taken.includes(next) || next === 'dm') {
      next = this.s.order.find((p) => !this.s.taken.includes(p));
    }
    if (!next) { this.beginTurn('dm'); return { ok: true }; }
    this.beginTurn(next);
    return { ok: true };
  }

  _expireTurn(side) {
    for (const e of this.s.board) {
      if (e.side !== side) continue;
      // remove this-turn buffs
      let da = 0, dh = 0;
      e.buffs = (e.buffs || []).filter((b) => { if (b.duration === 'turn') { da += b.a; dh += b.h; return false; } return true; });
      e.attack -= da; e.maxHealth -= dh; e.health = Math.min(e.health, e.maxHealth);
      e.tempKeywords = (e.tempKeywords || []).filter((t) => t.duration !== 'turn');
    }
    this._cleanupDeaths();
  }

  // ---- win ----
  _checkWin() {
    if (this.s.winner) return;
    if (this.s.partyHP <= 0) { this.s.winner = 'dm'; this.log('Party HP reached 0 — DM wins.', 'system'); }
    else if (this.s.dmHP <= 0) { this.s.winner = 'party'; this.log('DM HP reached 0 — the party wins!', 'system'); }
  }
  declareWinner(side) { this.snapshot(); this.s.winner = side; this.log(`DM declares ${side === 'party' ? 'the party' : 'the DM'} the winner.`, 'system'); }

  // ---- DM controls ----
  dmEdit(path, value) {
    this.snapshot();
    const map = {
      partyHP: 'partyHP', partyHPMax: 'partyHPMax', partyShield: 'partyShield',
      dmHP: 'dmHP', dmHPMax: 'dmHPMax', dmShield: 'dmShield',
      mana: 'mana.available', dmMana: 'dmMana.available', round: 'round',
    };
    const p = map[path] || path;
    const parts = p.split('.');
    let obj = this.s;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    this.log(`DM set ${path} = ${value}.`, 'dm');
    return { ok: true };
  }
  dmEditEntity(instId, field, value) {
    const e = this.ent(instId);
    if (!e) return { error: 'No entity.' };
    this.snapshot();
    if (field === 'attack') e.attack = value;
    else if (field === 'health') { e.health = value; e.maxHealth = Math.max(e.maxHealth, value); }
    else if (field === 'shield') e.shield = value;
    else if (field === 'addKeyword') { if (!e.keywords.includes(value)) e.keywords.push(value); }
    else if (field === 'removeKeyword') { e.keywords = e.keywords.filter((k) => k !== value); e.tempKeywords = e.tempKeywords.filter((t) => t.kw !== value); }
    this.log(`DM edits ${e.name}: ${field} = ${value}.`, 'dm');
    return { ok: true };
  }
  dmMove(instId, from, to, ownerId) {
    // move a card instance / entity between zones
    this.snapshot();
    let inst = null;
    const pull = (arr) => { const i = arr.findIndex((c) => c.instId === instId); return i >= 0 ? arr.splice(i, 1)[0] : null; };
    if (from === 'board') { const e = this.ent(instId); if (e) { this.s.board.splice(this.s.board.indexOf(e), 1); inst = { instId: e.instId, cardId: e.cardId, owner: e.owner }; } }
    else if (from === 'graveyard') inst = pull(this.s.graveyard);
    else if (from === 'exile') inst = pull(this.s.exile);
    else if (from === 'hand') inst = pull(this.handOf(ownerId));
    else if (from === 'deck') inst = pull(this.deckOf(ownerId));
    if (!inst) return { error: 'Card not found in source zone.' };
    const owner = ownerId || inst.owner;
    inst.owner = owner;
    const card = this.card(inst.cardId);
    if (to === 'board' && card) { const e = this._makeEntity(card, this.sideOf(owner), owner); this.s.board.push(e); }
    else if (to === 'graveyard') this.s.graveyard.push(inst);
    else if (to === 'exile') this.s.exile.push(inst);
    else if (to === 'hand') this.handOf(owner).push(inst);
    else if (to === 'deck') this.deckOf(owner).push(inst);
    this.log(`DM moves ${card ? card.name : 'a card'} from ${from} to ${to}.`, 'dm');
    return { ok: true };
  }
  dmGiveCard(cardId, ownerId, zone = 'hand') {
    const card = this.card(cardId);
    if (!card) return { error: 'Unknown card.' };
    this.snapshot();
    const inst = this._inst(cardId, ownerId);
    if (zone === 'board') { const e = this._makeEntity(card, this.sideOf(ownerId), ownerId); this.s.board.push(e); }
    else if (zone === 'deck') this.deckOf(ownerId).push(inst);
    else this.handOf(ownerId).push(inst);
    this.log(`DM gives ${card.name} to ${this._name(ownerId)} (${zone}).`, 'dm');
    return { ok: true };
  }
  dmSuppress(cardId) {
    this.snapshot();
    const i = this.s.suppressed.indexOf(cardId);
    if (i >= 0) this.s.suppressed.splice(i, 1); else this.s.suppressed.push(cardId);
    this.log(`DM ${i >= 0 ? 'un-' : ''}suppresses triggers for ${this.card(cardId)?.name || cardId}.`, 'dm');
    return { ok: true };
  }
  reorderDeck(ownerId, instIds) {
    this.snapshot();
    const deck = this.deckOf(ownerId);
    const map = new Map(deck.map((c) => [c.instId, c]));
    const next = [];
    for (const id of instIds) if (map.has(id)) { next.push(map.get(id)); map.delete(id); }
    for (const c of map.values()) next.push(c);
    deck.length = 0; deck.push(...next);
    this.log(`DM reorders ${this._name(ownerId)}'s deck.`, 'dm');
    return { ok: true };
  }

  // ---- view (per recipient redaction) ----
  publicEntity(e) { return e; }
  viewFor(pid, isDM) {
    const s = this.s;
    const v = {
      round: s.round, phase: s.phase, activeId: s.activeId, isDM: s.isDM,
      order: s.order, taken: s.taken,
      partyHP: s.partyHP, partyHPMax: s.partyHPMax, partyShield: s.partyShield,
      dmHP: s.dmHP, dmHPMax: s.dmHPMax, dmShield: s.dmShield,
      mana: s.mana, dmMana: isDM ? s.dmMana : { available: s.dmMana.available, burst: s.dmMana.burst },
      board: s.board,
      graveyard: s.graveyard,
      exile: s.exile,
      players: s.players.map((p) => ({
        ...p,
        handCount: (s.hands[p.id] || []).length,
        deckCount: (s.decks[p.id] || []).length,
        mulligans: s.mulligans[p.id] || 0,
      })),
      dm: { handCount: s.dmHand.length, deckCount: s.dmDeck.length },
      log: s.log.slice(-200),
      winner: s.winner,
      suppressed: s.suppressed,
      difficulty: s.difficulty,
      yourHand: isDM ? s.dmHand : (s.hands[pid] || []),
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
    };
    if (isDM) {
      v.allHands = {};
      for (const p of s.players) v.allHands[p.id] = s.hands[p.id] || [];
      v.dmHandFull = s.dmHand;
      v.allDecks = {};
      for (const p of s.players) v.allDecks[p.id] = s.decks[p.id] || [];
      v.dmDeckFull = s.dmDeck;
    }
    return v;
  }
}

export default GameState;
