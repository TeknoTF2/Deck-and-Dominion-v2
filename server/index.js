// index.js — HTTP + Socket.IO server. Serves the SPA, exposes the card DB,
// and routes all game/lobby actions over a single 'action' channel.
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

import { SessionManager, DIFFICULTY_HP } from './session.js';
import { allCards, getStarterDecks, getCard, CLASSES, ARCHETYPES } from './cards.js';
import { generatePack, bulkGenerate, TIER_WEIGHTS } from './packs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const manager = new SessionManager();

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Card database (loaded once by the client).
app.get('/api/cards', (req, res) => res.json(allCards()));
app.get('/api/starters', (req, res) => res.json(getStarterDecks()));
app.get('/api/meta', (req, res) => res.json({ classes: CLASSES, archetypes: ARCHETYPES, difficulties: DIFFICULTY_HP, tierWeights: TIER_WEIGHTS }));
app.get('/healthz', (req, res) => res.json({ ok: true, sessions: manager.sessions.size }));

// ---- broadcast helpers ----
function youView(session, p) {
  return {
    id: p.id, name: p.name, isDM: p.isDM, class: p.class, archetype: p.archetype,
    collection: p.collection, decks: p.decks, activeDeckId: p.activeDeckId,
    favorites: p.favorites || [], ready: p.ready, spectator: p.spectator,
  };
}
function broadcast(session) {
  for (const p of Object.values(session.players)) {
    if (!p.socketId) continue;
    const sock = io.sockets.sockets.get(p.socketId);
    if (!sock) continue;
    sock.emit('state', {
      lobby: session.publicLobby(),
      game: session.game ? session.game.viewFor(p.id, p.isDM) : null,
      you: youView(session, p),
      gifts: session.gifts.filter((g) => g.status === 'pending' && (g.toId === p.id || g.fromId === p.id)),
      chat: session.chat.filter((c) => !c.whisperTo || c.whisperTo === p.id || c.from === p.id || p.isDM).slice(-100),
      dmDeck: p.isDM ? session.dmDeck : undefined,
      packPreview: p.isDM ? session._packPreview : undefined,
    });
  }
}

function requireSession(socket) {
  const code = socket.data.code;
  const s = manager.get(code);
  if (!s) return null;
  return s;
}
function me(socket, session) { return session.players[socket.data.playerId]; }
function isMyTurn(game, pid) { return game.s.activeId === pid; }

io.on('connection', (socket) => {
  socket.on('action', async (msg, ack) => {
    ack = typeof ack === 'function' ? ack : () => {};
    try {
      const r = handleAction(socket, msg || {});
      ack(r || { ok: true });
    } catch (err) {
      console.error('action error', msg?.type, err);
      ack({ error: err.message || 'Server error.' });
    }
  });

  socket.on('disconnect', () => {
    const s = requireSession(socket);
    if (!s) return;
    const p = me(socket, s);
    if (p) { p.connected = false; p.socketId = null; }
    broadcast(s);
    setTimeout(() => manager.cleanup(), 60000);
  });
});

function attach(socket, session, player, isDM) {
  socket.data.code = session.code;
  socket.data.playerId = player.id;
  socket.data.isDM = isDM;
  player.socketId = socket.id;
  player.connected = true;
  socket.join(session.code);
}

function handleAction(socket, msg) {
  const { type } = msg;

  // ---- session entry (no session required) ----
  if (type === 'createSession') {
    const { session, player } = manager.create(msg.name || 'DM', msg.asDM !== false);
    attach(socket, session, player, player.isDM);
    broadcast(session);
    return { ok: true, code: session.code, playerId: player.id, isDM: player.isDM };
  }
  if (type === 'joinSession') {
    const res = manager.join(msg.code, msg.name || 'Player', !!msg.asDM);
    if (res.error) return res;
    attach(socket, res.session, res.player, res.player.isDM);
    broadcast(res.session);
    return { ok: true, code: res.session.code, playerId: res.player.id, isDM: res.player.isDM };
  }
  if (type === 'resume') {
    const s = manager.get(msg.code);
    if (!s) return { error: 'Session not found.' };
    const p = s.players[msg.playerId];
    if (!p) return { error: 'Player not found in session.' };
    attach(socket, s, p, p.isDM);
    broadcast(s);
    return { ok: true, code: s.code, playerId: p.id, isDM: p.isDM };
  }

  const session = requireSession(socket);
  if (!session) return { error: 'Not in a session.' };
  const player = me(socket, session);
  if (!player) return { error: 'Unknown player.' };
  const isDM = player.isDM;
  const game = session.game;

  const done = (r) => { broadcast(session); return r || { ok: true }; };

  switch (type) {
    // ---- lobby ----
    case 'chooseClass': return done(session.chooseClass(player.id, msg.cls, msg.archetype));
    case 'setReady': player.ready = !!msg.ready; return done();
    case 'setSpectator': player.spectator = !!msg.spectator; return done();
    case 'setName': player.name = String(msg.name || player.name).slice(0, 24); return done();
    case 'setDifficulty':
      if (!isDM) return { error: 'DM only.' };
      session.settings.difficulty = msg.difficulty; return done();
    case 'kickPlayer':
      if (!isDM) return { error: 'DM only.' };
      session.removePlayer(msg.playerId); return done();
    case 'startGame': {
      if (!isDM) return { error: 'DM only.' };
      const r = session.startGame();
      return done(r);
    }
    case 'endGame':
      if (!isDM) return { error: 'DM only.' };
      return done(session.endGame(msg.winner || 'party'));
    case 'returnToLobby':
      if (!isDM) return { error: 'DM only.' };
      session.game = null; session.status = 'lobby';
      for (const p of Object.values(session.players)) p.ready = false;
      return done();
    case 'chat': {
      const text = String(msg.text || '').slice(0, 500);
      if (!text) return { error: 'Empty.' };
      session.chat.push({ from: player.id, fromName: player.name, text, whisperTo: msg.whisperTo || null, t: Date.now() });
      if (session.chat.length > 300) session.chat.shift();
      return done();
    }

    // ---- collection & decks ----
    case 'saveDeck': return done(session.saveDeck(player.id, msg.deck));
    case 'deleteDeck': return done(session.deleteDeck(player.id, msg.deckId));
    case 'setActiveDeck': return done(session.setActiveDeck(player.id, msg.deckId));
    case 'setFavorite': session.setFavorite(player.id, msg.cardId, msg.fav); return done();
    case 'sendGift': return done(session.sendGift(player.id, msg.toId, msg.cardId));
    case 'respondGift': return done(session.respondGift(msg.giftId, msg.accept));
    case 'exportPlayer': return { ok: true, data: session.exportPlayer(player.id) };
    case 'importPlayer': return done(session.importPlayer(player.id, msg.data));

    // ---- DM meta ----
    case 'exportCampaign':
      if (!isDM) return { error: 'DM only.' };
      return { ok: true, data: session.exportCampaign() };
    case 'importCampaign':
      if (!isDM) return { error: 'DM only.' };
      return done(session.importCampaign(msg.data));
    case 'setDmDeck':
      if (!isDM) return { error: 'DM only.' };
      return done(session.setDmDeck(msg.cards));
    case 'saveDmDeck':
      if (!isDM) return { error: 'DM only.' };
      return done(session.saveDmDeck(msg.name || 'Encounter'));
    case 'generatePack': {
      if (!isDM) return { error: 'DM only.' };
      const preview = generatePack({ tier: msg.tier, size: msg.size, filters: msg.filters || {}, weights: msg.weights });
      session._packPreview = preview.map((id) => getCard(id));
      broadcast(session);
      return { ok: true, preview };
    }
    case 'bulkPacks': {
      if (!isDM) return { error: 'DM only.' };
      const packs = bulkGenerate(msg.count || 1, { tier: msg.tier, size: msg.size, filters: msg.filters || {}, weights: msg.weights });
      return { ok: true, packs };
    }
    case 'givePack': {
      if (!isDM) return { error: 'DM only.' };
      return done(session.giveCards(msg.toId, msg.cardIds || []));
    }
    case 'giveCard': {
      if (!isDM) return { error: 'DM only.' };
      return done(session.giveCards(msg.toId, [msg.cardId]));
    }
    case 'removeCard': {
      if (!isDM) return { error: 'DM only.' };
      const p = session.players[msg.playerId];
      if (p && p.collection[msg.cardId]) { p.collection[msg.cardId]--; if (p.collection[msg.cardId] <= 0) delete p.collection[msg.cardId]; }
      return done();
    }
    case 'resetCollection': {
      if (!isDM) return { error: 'DM only.' };
      const p = session.players[msg.playerId];
      if (p) p.collection = {};
      return done();
    }
    case 'giveStarter': {
      if (!isDM) return { error: 'DM only.' };
      const p = session.players[msg.playerId];
      if (p && p.class && p.archetype) return done(session.chooseClass(p.id, p.class, p.archetype));
      return { error: 'Player has no class/archetype.' };
    }

    // ---- in-game (require active game) ----
  }

  if (!game) return { error: 'No active game.' };

  // helper: who may act this card/attack
  const isReaction = (cardId) => /^reaction:/i.test(getCard(cardId)?.text || '');

  switch (type) {
    case 'playCard': {
      const inst = (isDM ? game.s.dmHand : (game.s.hands[player.id] || [])).find((c) => c.instId === msg.instId);
      const allowOffTurn = isDM || (inst && isReaction(inst.cardId));
      if (!isMyTurn(game, isDM ? 'dm' : player.id) && !allowOffTurn) return { error: 'Not your turn (only reactions can be played off-turn).' };
      const actor = isDM ? 'dm' : player.id;
      return done(game.playCard(actor, msg.instId, { targets: msg.targets, free: isDM && msg.free }));
    }
    case 'attack': {
      const actor = isDM ? 'dm' : player.id;
      if (!isMyTurn(game, actor) && !isDM) return { error: 'Not your turn.' };
      return done(game.declareAttack(actor, msg.attackerId, msg.targetId));
    }
    case 'tapLand': return done(game.tapLand(msg.instId));
    case 'mulligan': return done(game.mulligan(isDM ? 'dm' : player.id));
    case 'nextPhase':
      if (!isMyTurn(game, isDM ? 'dm' : player.id) && !isDM) return { error: 'Not your turn.' };
      return done(game.nextPhase());
    case 'setPhase':
      if (!isDM && !isMyTurn(game, player.id)) return { error: 'Not your turn.' };
      return done(game.setPhase(msg.phase));
    case 'endTurn': {
      const actor = isDM ? game.s.activeId : player.id;
      if (game.s.activeId !== actor && !isDM) return { error: 'Not your turn.' };
      return done(game.endTurn(msg.nextId));
    }
    case 'drawCard':
      if (!isDM && !isMyTurn(game, player.id)) return { error: 'Not your turn.' };
      game.snapshot(); game.drawFor(isDM && msg.ownerId ? msg.ownerId : player.id, msg.n || 1);
      return done();

    // ---- DM in-game controls ----
    case 'dmEdit': if (!isDM) return { error: 'DM only.' }; return done(game.dmEdit(msg.path, msg.value));
    case 'dmEditEntity': if (!isDM) return { error: 'DM only.' }; return done(game.dmEditEntity(msg.instId, msg.field, msg.value));
    case 'dmMove': if (!isDM) return { error: 'DM only.' }; return done(game.dmMove(msg.instId, msg.from, msg.to, msg.ownerId));
    case 'dmGiveCard': if (!isDM) return { error: 'DM only.' }; return done(game.dmGiveCard(msg.cardId, msg.ownerId, msg.zone));
    case 'dmSuppress': if (!isDM) return { error: 'DM only.' }; return done(game.dmSuppress(msg.cardId));
    case 'reorderDeck': if (!isDM) return { error: 'DM only.' }; return done(game.reorderDeck(msg.ownerId, msg.instIds));
    case 'undo': if (!isDM) return { error: 'DM only.' }; game.undo(); return done();
    case 'redo': if (!isDM) return { error: 'DM only.' }; game.redo(); return done();
    case 'declareWinner': if (!isDM) return { error: 'DM only.' }; game.declareWinner(msg.side); session.status = 'ended'; return done();
    case 'beginTurnFor': if (!isDM) return { error: 'DM only.' }; game.snapshot(); game.beginTurn(msg.pid); return done();

    default: return { error: 'Unknown action: ' + type };
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Deck & Dominion listening on :${PORT}`));
