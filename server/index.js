// Deck & Dominion — server. Express static + Socket.IO realtime sessions.
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game } = require('./engine');
const { CARDS, STARTER_DECKS, CLASS_INFO, starterDeckList } = require('./cards');
const { generatePack, DEFAULT_WEIGHTS } = require('./packs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/api/cards', (_req, res) => res.json({ cards: CARDS, starters: STARTER_DECKS, classes: CLASS_INFO }));
app.get('/healthz', (_req, res) => res.send('ok'));

const sessions = {}; // code -> { game, sockets: Map<pid, Set<socket>>, timers }

function code4() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return sessions[c] ? code4() : c;
}

function session(code) { return sessions[code]; }

// ---------- tailored state views ----------
function publicPlayer(p) {
  return { id: p.id, name: p.name, cls: p.cls, arch: p.arch, ready: p.ready, connected: p.connected, handCount: p.hand.length, deckCount: p.deck.length, lands: p.lands, landsPlayed: p.landsPlayed, mulligans: p.mulligans, isDM: !!p.isDM };
}

function buildView(g, pid) {
  const isDM = pid === 'dm';
  const me = isDM ? null : g.players[pid];
  const view = {
    code: g.code, state: g.state, winner: g.winner, paused: g.paused,
    you: pid, isDM, spectator: !me && !isDM,
    players: Object.values(g.players).map(publicPlayer),
    shared: g.shared,
    dm: { hp: g.dm.hp, maxHp: g.dm.maxHp, mana: g.dm.mana || 0, handCount: g.dm.hand.length, deckCount: g.dm.deck.length, lands: g.dm.lands, landsPlayed: g.dm.landsPlayed, deckNames: g.dm.decks.map(d => d.name), activeDeck: g.dm.activeDeck },
    board: g.board,
    grave: g.grave, exile: g.exilePile, dmGrave: g.dmGrave, dmExile: g.dmExile,
    turn: g.turn, log: g.log.slice(-400),
    chat: g.chat.filter(m => !m.to || m.to === pid || m.from === pid || isDM).slice(-200),
    gifts: g.gifts.filter(gf => gf.to === pid || gf.from === pid || isDM),
    giftHistory: g.giftHistory.slice(-100),
    art: g.artOverrides,
    pendingReaction: g.pendingReaction ? { kind: g.pendingReaction.kind, cardName: g.pendingReaction.cardName, subject: g.pendingReaction.subject, attacker: g.pendingReaction.attacker, target: g.pendingReaction.target, bySide: g.pendingReaction.bySide, waiting: g.pendingReaction.waiting, mine: (g.pendingReaction.waiting || []).includes(pid) } : null,
  };
  if (me) {
    view.hand = me.hand;
    view.collection = me.collection;
    view.decks = me.decks;
    view.favorites = me.favorites;
    view.activeDeck = me.activeDeck;
  }
  if (isDM) {
    view.hand = g.dm.hand;
    view.dmDeck = g.dm.deck;
    view.dmDecks = g.dm.decks;
    view.allHands = {};
    view.allDecks = {};
    view.allCollections = {};
    for (const [id, p] of Object.entries(g.players)) { view.allHands[id] = p.hand; view.allDecks[id] = p.deck; view.allCollections[id] = p.collection; }
    view.historyLabels = g.history.map((h, i) => ({ i, label: h.label }));
  }
  return view;
}

function broadcast(code) {
  const s = session(code);
  if (!s) return;
  for (const [pid, socks] of s.sockets) {
    const view = buildView(s.game, pid);
    for (const sock of socks) sock.emit('state', view);
  }
  drainPeeks(code);
}

function drainPeeks(code) {
  const s = session(code);
  if (!s) return;
  const g = s.game;
  if (!g.peeks || !g.peeks.length) return;
  g.pendingPeeks = g.pendingPeeks || {};
  for (const pk of g.peeks.splice(0)) {
    g.pendingPeeks[pk.token] = pk;
    const socks = s.sockets.get(pk.for);
    if (socks) for (const sock of socks) sock.emit('peek', pk);
  }
}

// ---------- reaction windows ----------
function eligibleReactors(g, kind, actorSide) {
  const out = [];
  const canAfford = (hand, mana) => hand.some(h => {
    const c = CARDS[h.cardId];
    return c && c.reaction && (c.reaction.on === kind || c.reaction.on === 'any') && (c.cost || 0) <= mana;
  });
  if (actorSide === 'dm') {
    const partyMana = g.shared.manaPersist + g.shared.manaBurst;
    for (const [id, p] of Object.entries(g.players)) {
      if (p.connected && canAfford(p.hand, partyMana)) out.push(id);
    }
  } else {
    if (canAfford(g.dm.hand, g.dm.mana || 0)) out.push('dm');
  }
  return out;
}

function openReactionWindow(code, kind, data) {
  const s = session(code);
  const g = s.game;
  const reactors = eligibleReactors(g, kind, data.bySide);
  if (!reactors.length) { resolveWindow(code, Object.assign({ kind }, data)); broadcast(code); return; }
  g.pendingReaction = Object.assign({ kind, waiting: reactors, negated: false, newTarget: null }, data);
  clearTimeout(s.reactionTimer);
  s.reactionTimer = setTimeout(() => { const gg = session(code); if (gg && gg.game.pendingReaction) closeWindow(code); }, 60000);
  broadcast(code);
}

function resolveWindow(code, data) {
  const g = session(code).game;
  if (data.kind === 'spell' && data.pendingSpell) g.resolveSpell(data.pendingSpell);
  if (data.kind === 'attack' && data.pa) g.resolveAttack(data.pa);
  g.pendingReaction = null;
}

function closeWindow(code) {
  const s = session(code);
  const g = s.game;
  const pr = g.pendingReaction;
  if (!pr) return;
  clearTimeout(s.reactionTimer);
  if (pr.kind === 'spell' && pr.pendingSpell) g.resolveSpell(pr.pendingSpell);
  if (pr.kind === 'attack' && pr.pa) g.resolveAttack(pr.pa);
  g.pendingReaction = null;
  broadcast(code);
}

// dispatch a played card's follow-ups (reaction windows)
function afterPlay(code, g, pid, result, payload) {
  if (result.pending) {
    const c = CARDS[result.pending.cardId];
    openReactionWindow(code, 'spell', { pendingSpell: result.pending, bySide: result.pending.side, cardName: c.name });
    return;
  }
  if (result.reactionEvent) {
    openReactionWindow(code, 'creaturePlayed', { subject: result.reactionEvent.subject, bySide: result.reactionEvent.bySide, cardName: (CARDS[payload && payload.cardId] || {}).name });
    return;
  }
  broadcast(code);
}

io.on('connection', (socket) => {
  let myCode = null, myPid = null;

  const g = () => (session(myCode) || {}).game;
  const guard = (fn) => (...args) => { try { fn(...args); } catch (e) { console.error(e); socket.emit('err', { msg: 'Server error: ' + e.message }); } };
  const reply = (res) => { if (res && res.err) socket.emit('err', { msg: res.err }); };
  const attach = (code, pid) => {
    myCode = code; myPid = pid;
    const s = session(code);
    if (!s.sockets.has(pid)) s.sockets.set(pid, new Set());
    s.sockets.get(pid).add(socket);
  };
  const mutate = (label, fn) => {
    const game = g();
    if (!game) return;
    if (game.paused && myPid !== 'dm') { socket.emit('err', { msg: 'Game is paused by the DM' }); return; }
    game.pushHistory(label);
    const res = fn(game);
    reply(res);
    if (res && res.err && !res.softFail) game.history.pop(); // don't record failed actions
    broadcast(myCode);
    return res;
  };

  socket.on('createSession', guard(({ name }) => {
    const code = code4();
    const game = new Game(code, name);
    sessions[code] = { game, sockets: new Map() };
    game.addLog(`Session ${code} created by DM ${name}`, 'system');
    attach(code, 'dm');
    game.dmName = name;
    socket.emit('joined', { code, pid: 'dm', isDM: true });
    broadcast(code);
  }));

  socket.on('join', guard(({ code, name, token, spectator }) => {
    code = String(code || '').toUpperCase().trim();
    const s = session(code);
    if (!s) { socket.emit('err', { msg: 'No such session' }); return; }
    const game = s.game;
    // DM rejoin
    if (token === 'dm' && name === game.dmName) {
      attach(code, 'dm');
      socket.emit('joined', { code, pid: 'dm', isDM: true });
      broadcast(code);
      return;
    }
    let pid = token && game.players[token] ? token : null;
    if (!pid) {
      // rejoin by name
      const existing = Object.values(game.players).find(p => p.name === name);
      if (existing) pid = existing.id;
    }
    if (spectator && !pid) {
      const sid = 'spec_' + Math.random().toString(36).slice(2, 8);
      game.addPlayer(sid, name, true);
      attach(code, sid);
      socket.emit('joined', { code, pid: sid, isDM: false, spectator: true });
      broadcast(code);
      return;
    }
    if (!pid) {
      pid = 'p_' + Math.random().toString(36).slice(2, 10);
      game.addPlayer(pid, name);
      game.addLog(`${name} joined the session`, 'system');
    } else {
      game.players[pid].connected = true;
      game.addLog(`${name} reconnected`, 'system');
    }
    attach(code, pid);
    socket.emit('joined', { code, pid, isDM: false });
    broadcast(code);
  }));

  socket.on('disconnect', guard(() => {
    const s = session(myCode);
    if (!s) return;
    const set = s.sockets.get(myPid);
    if (set) { set.delete(socket); if (!set.size && s.game.players[myPid]) { s.game.players[myPid].connected = false; s.game.addLog(`${s.game.players[myPid].name} disconnected (state held — rejoin via lobby)`, 'system'); broadcast(myCode); } }
  }));

  // ---------- lobby ----------
  socket.on('selectClass', guard(({ cls, arch }) => {
    const game = g(); if (!game || !game.players[myPid]) return;
    const p = game.players[myPid];
    const firstTime = !p.cls;
    if (firstTime) game.giveStarterDeck(myPid, cls, arch);
    else { p.cls = cls; p.arch = arch; if (!p.decks.length) game.giveStarterDeck(myPid, cls, arch); }
    broadcast(myCode);
  }));
  socket.on('ready', guard(({ ready }) => { const game = g(); if (game && game.players[myPid]) { game.players[myPid].ready = !!ready; broadcast(myCode); } }));
  socket.on('setActiveDeck', guard(({ name }) => { const game = g(); if (game && game.players[myPid]) { game.players[myPid].activeDeck = name; broadcast(myCode); } }));

  // ---------- deck building / collection ----------
  socket.on('saveDeck', guard(({ name, cards, overwrite }) => {
    const game = g(); if (!game) return;
    if (myPid === 'dm') {
      const ex = game.dm.decks.findIndex(d => d.name === name);
      if (ex >= 0) game.dm.decks[ex] = { name, cards }; else game.dm.decks.push({ name, cards });
      broadcast(myCode); return;
    }
    const p = game.players[myPid]; if (!p) return;
    if (cards.length < 30 || cards.length > 60) { socket.emit('err', { msg: 'Decks must be 30-60 cards' }); return; }
    // class restriction + ownership
    const counts = {};
    for (const id of cards) counts[id] = (counts[id] || 0) + 1;
    for (const [id, n] of Object.entries(counts)) {
      const c = CARDS[id];
      if (!c) { socket.emit('err', { msg: 'Unknown card ' + id }); return; }
      if (c.cls !== 'neutral' && c.cls !== p.cls) { socket.emit('err', { msg: `${c.name} is not a ${p.cls} card` }); return; }
      if (id !== 'land_basic' && (p.collection[id] || 0) < n) { socket.emit('err', { msg: `You only own ${p.collection[id] || 0}x ${c.name}` }); return; }
    }
    const ex = p.decks.findIndex(d => d.name === name);
    if (ex >= 0 && !overwrite) { socket.emit('err', { msg: 'Deck name exists (use overwrite)' }); return; }
    if (ex >= 0) p.decks[ex] = { name, cards }; else p.decks.push({ name, cards });
    game.addLog(`${p.name} saved deck "${name}" (${cards.length} cards)`);
    broadcast(myCode);
  }));
  socket.on('deleteDeck', guard(({ name }) => {
    const game = g(); if (!game) return;
    const holder = myPid === 'dm' ? game.dm : game.players[myPid];
    if (!holder) return;
    holder.decks = holder.decks.filter(d => d.name !== name);
    if (holder.activeDeck === name) holder.activeDeck = holder.decks[0] ? holder.decks[0].name : null;
    broadcast(myCode);
  }));
  socket.on('favorite', guard(({ cardId, on }) => {
    const game = g(); const p = game && game.players[myPid]; if (!p) return;
    if (on && !p.favorites.includes(cardId)) p.favorites.push(cardId);
    if (!on) p.favorites = p.favorites.filter(x => x !== cardId);
    broadcast(myCode);
  }));
  socket.on('setDMDeck', guard(({ name }) => { const game = g(); if (game && myPid === 'dm') { game.dm.activeDeck = name; broadcast(myCode); } }));

  // ---------- import / export ----------
  socket.on('exportState', guard(({ scope }, cb) => {
    const game = g(); if (!game) return;
    let data;
    if (scope === 'campaign' && myPid === 'dm') {
      data = { type: 'campaign', players: {}, dmDecks: game.dm.decks, art: game.artOverrides };
      for (const p of Object.values(game.players)) data.players[p.name] = { cls: p.cls, arch: p.arch, collection: p.collection, decks: p.decks, favorites: p.favorites };
    } else {
      const p = game.players[myPid]; if (!p) return;
      data = { type: 'player', name: p.name, cls: p.cls, arch: p.arch, collection: p.collection, decks: p.decks, favorites: p.favorites };
    }
    if (typeof cb === 'function') cb(data); else socket.emit('exported', data);
  }));
  socket.on('importState', guard(({ data }) => {
    const game = g(); if (!game || !data) return;
    if (data.type === 'campaign' && myPid === 'dm') {
      for (const [name, pd] of Object.entries(data.players || {})) {
        const p = Object.values(game.players).find(x => x.name === name);
        if (p) Object.assign(p, { cls: pd.cls, arch: pd.arch, collection: pd.collection || {}, decks: pd.decks || [], favorites: pd.favorites || [] });
      }
      if (data.dmDecks) game.dm.decks = data.dmDecks;
      if (data.art) game.artOverrides = data.art;
      game.addLog('DM imported campaign state', 'dm');
    } else if (data.type === 'player') {
      const p = game.players[myPid]; if (!p) return;
      Object.assign(p, { cls: data.cls || p.cls, arch: data.arch || p.arch, collection: data.collection || {}, decks: data.decks || [], favorites: data.favorites || [] });
      game.addLog(`${p.name} imported their player state`);
    } else if (data.type === 'deck') {
      const holder = myPid === 'dm' ? game.dm : game.players[myPid];
      if (holder && data.deck) holder.decks.push({ name: data.deck.name + ' (imported)', cards: data.deck.cards });
    } else if (data.type === 'inventory') {
      const p = game.players[myPid]; if (!p) return;
      p.collection = data.collection || {};
    }
    broadcast(myCode);
  }));

  // ---------- gifting ----------
  socket.on('sendGift', guard(({ to, cards }) => {
    const game = g(); const p = game && game.players[myPid];
    if (!p || !game.players[to]) return;
    for (const [id, n] of Object.entries(cards || {})) {
      if ((p.collection[id] || 0) < n) { socket.emit('err', { msg: 'You do not own enough copies' }); return; }
    }
    for (const [id, n] of Object.entries(cards)) { p.collection[id] -= n; if (p.collection[id] <= 0) delete p.collection[id]; }
    const gift = { id: 'g' + Date.now() + Math.random().toString(36).slice(2, 5), from: myPid, fromName: p.name, to, toName: game.players[to].name, cards, status: 'pending', t: Date.now() };
    game.gifts.push(gift);
    game.addLog(`${p.name} sent a gift to ${game.players[to].name}`);
    broadcast(myCode);
  }));
  socket.on('respondGift', guard(({ id, accept }) => {
    const game = g(); if (!game) return;
    const gift = game.gifts.find(x => x.id === id && x.to === myPid && x.status === 'pending');
    if (!gift) return;
    gift.status = accept ? 'accepted' : 'rejected';
    if (accept) {
      const p = game.players[myPid];
      for (const [cid, n] of Object.entries(gift.cards)) p.collection[cid] = (p.collection[cid] || 0) + n;
      game.addLog(`${gift.toName} accepted a gift from ${gift.fromName}`);
    } else {
      const from = game.players[gift.from];
      if (from) for (const [cid, n] of Object.entries(gift.cards)) from.collection[cid] = (from.collection[cid] || 0) + n;
      game.addLog(`${gift.toName} rejected a gift from ${gift.fromName} (cards returned)`);
    }
    game.giftHistory.push(gift);
    game.gifts = game.gifts.filter(x => x.id !== id);
    broadcast(myCode);
  }));

  // ---------- chat / art ----------
  socket.on('chat', guard(({ msg, to }) => {
    const game = g(); if (!game || !msg) return;
    const name = myPid === 'dm' ? 'DM' : (game.players[myPid] || { name: '?' }).name;
    game.chat.push({ from: myPid, fromName: name, msg: String(msg).slice(0, 500), to: to || null, t: Date.now() });
    if (game.chat.length > 500) game.chat.splice(0, 100);
    broadcast(myCode);
  }));
  socket.on('setArt', guard(({ cardId, dataUrl }) => {
    const game = g(); if (!game || !CARDS[cardId]) return;
    if (dataUrl && dataUrl.length > 400000) { socket.emit('err', { msg: 'Image too large (max ~300KB)' }); return; }
    if (dataUrl) game.artOverrides[cardId] = dataUrl; else delete game.artOverrides[cardId];
    broadcast(myCode);
  }));

  // ---------- game actions ----------
  socket.on('takeTurn', guard(() => mutate('take turn', (game) => game.takeTurn(myPid))));
  socket.on('passTo', guard(({ pid }) => mutate('pass turn', (game) => game.passTo(myPid, pid))));
  socket.on('nextPhase', guard(() => mutate('next phase', (game) => game.nextPhase(myPid))));
  socket.on('endTurn', guard(() => mutate('end turn', (game) => game.endTurn(myPid))));
  socket.on('tapLand', guard(({ landId }) => mutate('tap land', (game) => game.tapLand(myPid, landId))));
  socket.on('mulligan', guard(() => mutate('mulligan', (game) => game.mulligan(myPid))));
  socket.on('drawOrKeep', guard(({ choice }) => mutate('draw or keep', (game) => game.drawOrKeep(myPid, choice))));
  socket.on('discard', guard(({ inst }) => mutate('discard', (game) => game.discardCard(myPid, inst))));
  socket.on('activate', guard(({ uid, payload }) => mutate('ability', (game) => game.activate(myPid, uid, payload || {}))));
  socket.on('peekResolve', guard(({ token, resp }) => { const game = g(); if (!game) return; reply(game.resolvePeek(myPid, token, resp || {})); broadcast(myCode); }));

  socket.on('playCard', guard((payload) => {
    const game = g(); if (!game) return;
    if (game.paused && myPid !== 'dm') { socket.emit('err', { msg: 'Game paused' }); return; }
    game.pushHistory('play card');
    const res = game.playCard(myPid, payload || {});
    reply(res);
    if (res && res.err && !res.softFail) { game.history.pop(); broadcast(myCode); return; }
    afterPlay(myCode, game, myPid, res, payload);
  }));

  socket.on('attack', guard(({ attacker, target }) => {
    const game = g(); if (!game) return;
    if (game.paused && myPid !== 'dm') return;
    game.pushHistory('attack');
    const res = game.declareAttack(myPid, attacker, target);
    reply(res);
    if (res.err) { game.history.pop(); broadcast(myCode); return; }
    const pa = res.pendingAttack;
    game.addLog(`${(game.board.find(x => x.uid === attacker) || {}).name} declares an attack`, 'combat');
    openReactionWindow(myCode, 'attack', { pa, bySide: pa.side, attacker: pa.attacker, target: pa.target, subject: pa.target !== 'face' ? pa.target : null });
  }));

  socket.on('reactPass', guard(() => {
    const game = g(); if (!game || !game.pendingReaction) return;
    const pr = game.pendingReaction;
    pr.waiting = (pr.waiting || []).filter(x => x !== myPid);
    if (!pr.waiting.length) closeWindow(myCode); else broadcast(myCode);
  }));

  socket.on('playReaction', guard((payload) => {
    const game = g(); if (!game) return;
    payload = payload || {};
    payload.asReaction = true;
    const pr = game.pendingReaction;
    game.pushHistory('reaction');
    if (pr && payload.redirectTo) game.pendingReaction.newTarget = payload.redirectTo;
    const res = game.playCard(myPid, payload);
    reply(res);
    if (res && res.err) { game.history.pop(); broadcast(myCode); return; }
    if (pr) closeWindow(myCode); // one reaction per trigger
    else broadcast(myCode);
  }));

  // ---------- DM controls ----------
  socket.on('dmAction', guard((msg) => {
    const game = g(); if (!game || myPid !== 'dm') return;
    const op = msg.op;
    const noHistory = ['undo', 'redo', 'rewind', 'pause', 'genPacksPreview'];
    if (!noHistory.includes(op)) game.pushHistory('DM: ' + op);
    switch (op) {
      case 'startEncounter': {
        game.startEncounter({ partyHp: msg.partyHp, dmHp: msg.dmHp });
        break;
      }
      case 'endEncounter': {
        game.state = 'ended';
        game.winner = msg.winner || 'draw';
        game.addLog(`DM ended the battle — winner: ${game.winner}`, 'system');
        break;
      }
      case 'resume': game.state = 'playing'; game.winner = null; game.addLog('DM resumed the encounter', 'dm'); break;
      case 'toLobby': game.state = 'lobby'; game.winner = null; game.addLog('Back to the lobby — collections and decks carry over', 'system'); break;
      case 'editPartyHP': game.shared.hp = num(msg.value); if (msg.max) game.shared.maxHp = num(msg.max); game.addLog(`DM set party HP to ${game.shared.hp}`, 'dm'); game.checkEnd(); break;
      case 'editPartyShield': game.shared.shield = num(msg.value); game.addLog(`DM set party shield to ${game.shared.shield}`, 'dm'); break;
      case 'editDMHP': game.dm.hp = num(msg.value); if (msg.max) game.dm.maxHp = num(msg.max); game.addLog(`DM set DM HP to ${game.dm.hp}`, 'dm'); game.checkEnd(); break;
      case 'editMana': game.shared.manaPersist = num(msg.persist); game.shared.manaBurst = num(msg.burst); game.addLog('DM adjusted the mana pool', 'dm'); break;
      case 'editDMMana': game.dm.mana = num(msg.value); break;
      case 'editUnit': {
        const u = game.board.find(x => x.uid === msg.uid); if (!u) break;
        if (msg.atk != null) { u.baseAtk = num(msg.atk); u.permA = 0; }
        if (msg.hp != null) { const target = num(msg.hp); const cur = game.stats(u); u.dmg = 0; u.baseHp = target - (cur.hp - u.baseHp - 0) + u.dmg; u.baseHp = target; u.permH = 0; }
        if (msg.shield != null) u.shield = num(msg.shield);
        game.addLog(`DM edits ${u.name} to ${game.stats(u).atk}/${game.stats(u).effHp}`, 'dm');
        game.checkDeaths();
        break;
      }
      case 'killUnit': { const u = game.board.find(x => x.uid === msg.uid); if (u) game.die(u, { noGuard: true }); break; }
      case 'exileUnit': { const u = game.board.find(x => x.uid === msg.uid); if (u) game.die(u, { noGuard: true, exile: true }); break; }
      case 'suppressTriggers': { const u = game.board.find(x => x.uid === msg.uid); if (u) { u.suppressTriggers = !!msg.on; game.addLog(`DM ${msg.on ? 'suppressed' : 'unsuppressed'} triggers on ${u.name}`, 'dm'); } break; }
      case 'fireTrigger': {
        const u = game.board.find(x => x.uid === msg.uid); if (!u) break;
        const c = CARDS[u.cardId] || {};
        const acts = c[msg.trigger];
        if (acts) { game.addLog(`DM fires ${msg.trigger} trigger on ${u.name}`, 'dm'); game.runActions(acts, { side: u.side, owner: u.owner, self: u, targets: msg.targets || [] }); }
        break;
      }
      case 'moveCard': dmMoveCard(game, msg); break;
      case 'reorderDeck': {
        const holder = msg.pid === 'dm' ? game.dm : game.players[msg.pid];
        if (holder && Array.isArray(msg.order) && msg.order.length === holder.deck.length) {
          holder.deck = msg.order.map(i => holder.deck[i]).filter(x => x != null);
          game.addLog('DM reordered a deck', 'dm');
        }
        break;
      }
      case 'shuffleDeck': { const holder = msg.pid === 'dm' ? game.dm : game.players[msg.pid]; if (holder) { game.shuffle(holder.deck); game.addLog('DM shuffled a deck', 'dm'); } break; }
      case 'giveCards': {
        const p = game.players[msg.pid]; if (!p) break;
        for (const [cid, n] of Object.entries(msg.cards || {})) { if (CARDS[cid]) p.collection[cid] = (p.collection[cid] || 0) + n; }
        game.addLog(`DM gave cards to ${p.name}`, 'dm');
        break;
      }
      case 'removeCards': {
        const p = game.players[msg.pid]; if (!p) break;
        for (const [cid, n] of Object.entries(msg.cards || {})) { p.collection[cid] = Math.max(0, (p.collection[cid] || 0) - n); if (!p.collection[cid]) delete p.collection[cid]; }
        game.addLog(`DM removed cards from ${p.name}`, 'dm');
        break;
      }
      case 'transferCards': {
        const from = game.players[msg.from], to = game.players[msg.to]; if (!from || !to) break;
        for (const [cid, n] of Object.entries(msg.cards || {})) {
          const take = Math.min(n, from.collection[cid] || 0);
          from.collection[cid] = (from.collection[cid] || 0) - take; if (!from.collection[cid]) delete from.collection[cid];
          to.collection[cid] = (to.collection[cid] || 0) + take;
        }
        game.addLog(`DM transferred cards ${from.name} → ${to.name}`, 'dm');
        break;
      }
      case 'giveStarter': game.giveStarterDeck(msg.pid, msg.cls, msg.arch); break;
      case 'resetCollection': { const p = game.players[msg.pid]; if (p) { p.collection = {}; p.decks = []; p.activeDeck = null; game.addLog(`DM reset ${p.name}'s collection`, 'dm'); } break; }
      case 'genPacksPreview': {
        const packs = [];
        for (let i = 0; i < (msg.count || 1); i++) packs.push(generatePack(msg.tier, msg.size || 5, msg.filter || {}, msg.weights || null));
        socket.emit('packPreview', { packs, tier: msg.tier });
        return; // no broadcast/history
      }
      case 'givePacks': {
        const p = game.players[msg.pid]; if (!p) break;
        const all = [];
        for (let i = 0; i < (msg.count || 1); i++) {
          const pack = msg.packs && msg.packs[i] ? msg.packs[i] : generatePack(msg.tier, msg.size || 5, msg.filter || {}, msg.weights || null);
          for (const cid of pack) { p.collection[cid] = (p.collection[cid] || 0) + 1; all.push(cid); }
        }
        game.addLog(`DM gave ${msg.count || 1} ${msg.tier} pack(s) to ${p.name} (${all.length} cards)`, 'dm');
        const socks = session(myCode).sockets.get(msg.pid);
        if (socks) for (const sk of socks) sk.emit('packOpened', { cards: all, tier: msg.tier });
        break;
      }
      case 'kick': {
        const p = game.players[msg.pid];
        if (p) { game.addLog(`DM kicked ${p.name}`, 'dm'); delete game.players[msg.pid]; const socks = session(myCode).sockets.get(msg.pid); if (socks) for (const sk of socks) sk.emit('kicked'); session(myCode).sockets.delete(msg.pid); }
        break;
      }
      case 'pause': game.paused = !!msg.on; game.addLog(game.paused ? 'DM paused the game' : 'DM unpaused the game', 'dm'); break;
      case 'undo': game.undo(); break;
      case 'redo': game.redo(); break;
      case 'rewind': game.rewind(num(msg.idx)); break;
      case 'skipPhase': { game.nextPhase(game.turn.current || 'dm'); game.addLog('DM skipped a phase', 'dm'); break; }
      case 'forceTurn': { game.turn.pickingNext = true; game.takeTurn(msg.pid); break; }
      case 'forceResolve': closeWindow(myCode); return;
      case 'setTurnPhase': game.turn.phase = msg.phase; break;
      default: socket.emit('err', { msg: 'Unknown DM op ' + op });
    }
    broadcast(myCode);
  }));

  function num(v) { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

  function dmMoveCard(game, msg) {
    // from/to: {zone: hand|deck|deckBottom|board|grave|exile, who: pid|'dm'|'party', uid|inst|index}
    const { from, to } = msg;
    let cardId = null;
    // extract
    if (from.zone === 'board') {
      const u = game.board.find(x => x.uid === from.uid); if (!u) return;
      game.board = game.board.filter(x => x.uid !== u.uid);
      cardId = u.cardId === 'token' ? null : u.cardId;
      if (!cardId) { game.addLog('DM removed a token', 'dm'); return; }
    } else if (from.zone === 'hand') {
      const holder = from.who === 'dm' ? game.dm : game.players[from.who]; if (!holder) return;
      const i = holder.hand.findIndex(h => h.inst === from.inst); if (i < 0) return;
      cardId = holder.hand.splice(i, 1)[0].cardId;
    } else if (from.zone === 'deck') {
      const holder = from.who === 'dm' ? game.dm : game.players[from.who]; if (!holder) return;
      const i = from.index != null ? from.index : 0;
      if (i < 0 || i >= holder.deck.length) return;
      cardId = holder.deck.splice(i, 1)[0];
    } else if (from.zone === 'grave' || from.zone === 'exile') {
      const pile = from.zone === 'grave' ? (from.who === 'dm' ? game.dmGrave : game.grave) : (from.who === 'dm' ? game.dmExile : game.exilePile);
      const i = from.index != null ? from.index : 0;
      if (i < 0 || i >= pile.length) return;
      const e = pile.splice(i, 1)[0];
      cardId = e.cardId;
      if (e.token || cardId === 'token') { game.addLog('DM removed a token from a pile', 'dm'); return; }
    }
    if (!cardId) return;
    // insert
    const c = CARDS[cardId] || { name: cardId };
    if (to.zone === 'board') {
      const side = to.who === 'dm' ? 'dm' : 'party';
      const owner = to.who === 'dm' ? 'dm' : to.who;
      game.board.push(game.makeUnit(cardId, side, owner, {}));
    } else if (to.zone === 'hand') {
      const holder = to.who === 'dm' ? game.dm : game.players[to.who]; if (!holder) return;
      holder.hand.push({ inst: 'u' + Math.random().toString(36).slice(2, 9), cardId });
    } else if (to.zone === 'deck' || to.zone === 'deckBottom') {
      const holder = to.who === 'dm' ? game.dm : game.players[to.who]; if (!holder) return;
      if (to.zone === 'deck') holder.deck.unshift(cardId); else holder.deck.push(cardId);
    } else if (to.zone === 'grave') {
      (to.who === 'dm' ? game.dmGrave : game.grave).unshift({ cardId, name: c.name });
    } else if (to.zone === 'exile') {
      (to.who === 'dm' ? game.dmExile : game.exilePile).unshift({ cardId, name: c.name });
    }
    game.addLog(`DM moved ${c.name}: ${from.zone} → ${to.zone}`, 'dm');
    game.checkDeaths();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Deck & Dominion listening on :${PORT}`));
