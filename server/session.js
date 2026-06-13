// session.js — lobby, players, collections, deck building, gifting, and the
// bridge that spins up a GameState when an encounter starts. State is in-memory
// per the design (import/export replaces database persistence).
import { GameState } from './game.js';
import {
  starterFor, starterCollection, expandStarterCardIds, getCard, allCards,
  validateDeck, ARCHETYPES,
} from './cards.js';

const DIFFICULTY_HP = { Tutorial: 6, Easy: 8, Medium: 10, Hard: 12, Boss: 15 };

function code4() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
function uid() { return 'p' + Math.random().toString(36).slice(2, 9); }

function groupCounts(cardIds) {
  const map = {};
  for (const id of cardIds) map[id] = (map[id] || 0) + 1;
  return Object.entries(map).map(([cardId, count]) => ({ cardId, count }));
}

export class Session {
  constructor(hostName) {
    this.code = code4();
    this.status = 'lobby'; // lobby | active | ended
    this.players = {};      // id -> player
    this.dmId = null;
    this.hostId = null;
    this.game = null;
    this.chat = [];
    this.gifts = [];        // pending gifts
    this.settings = { difficulty: 'Medium' };
    this.dmDeck = [];       // DM encounter deck: [{cardId,count}]
    this.dmDecksSaved = {}; // saved encounter decks
    this.art = {};          // artId -> { id, name, by, mime }
    this.artBuf = {};       // artId -> Buffer (kept out of socket state)
  }

  addPlayer({ name, isDM = false }) {
    const id = uid();
    const player = {
      id, name: name || (isDM ? 'DM' : 'Player'), isDM,
      class: null, archetype: null,
      collection: {}, decks: {}, activeDeckId: null,
      ready: false, spectator: false, connected: true, socketId: null,
      favorites: [], cardArt: {},   // cardId -> artId (this player's chosen art)
    };
    this.players[id] = player;
    if (isDM && !this.dmId) this.dmId = id;
    if (!this.hostId) this.hostId = id;
    return player;
  }

  // ---- shared art database ----
  addArt({ name, by, mime, buffer }) {
    if (!buffer || !/^image\//.test(mime || '')) return { error: 'Not an image.' };
    if (buffer.length > 3 * 1024 * 1024) return { error: 'Image too large (max 3 MB).' };
    const id = 'art' + Math.random().toString(36).slice(2, 9);
    this.art[id] = { id, name: String(name || 'art').slice(0, 40), by: by || '', mime };
    this.artBuf[id] = buffer;
    return { ok: true, id };
  }
  artListPublic() { return Object.values(this.art); }
  getArt(id) { return this.artBuf[id] ? { meta: this.art[id], buf: this.artBuf[id] } : null; }
  deleteArt(id) { delete this.art[id]; delete this.artBuf[id]; for (const p of Object.values(this.players)) for (const [cid, a] of Object.entries(p.cardArt || {})) if (a === id) delete p.cardArt[cid]; }
  setCardArt(pid, cardId, artId) {
    const p = this.players[pid];
    if (!p) return { error: 'No player.' };
    p.cardArt = p.cardArt || {};
    if (artId && this.art[artId]) p.cardArt[cardId] = artId; else delete p.cardArt[cardId];
    return { ok: true };
  }
  artSelections() {
    const out = {};
    for (const p of Object.values(this.players)) out[p.id] = p.cardArt || {};
    return out;
  }

  removePlayer(id) { delete this.players[id]; }

  chooseClass(id, cls, archetype) {
    const p = this.players[id];
    if (!p) return { error: 'No player.' };
    if (!ARCHETYPES[cls] || !ARCHETYPES[cls].includes(archetype)) return { error: 'Invalid class/archetype.' };
    // unique-class enforcement (allow duplicate only if >5 players)
    const taken = Object.values(this.players).filter((x) => !x.isDM && x.id !== id && x.class === cls).length;
    const partySize = Object.values(this.players).filter((x) => !x.isDM).length;
    if (taken > 0 && partySize <= 5) return { error: `${cls} is already taken (duplicates allowed only with 6+ players).` };
    p.class = cls; p.archetype = archetype;
    // grant starter collection + deck
    const seed = starterCollection(starterFor(cls, archetype)?.id);
    p.collection = { ...seed };
    const did = 'starter';
    const cardIds = expandStarterCardIds(starterFor(cls, archetype)?.id);
    p.decks = { [did]: { id: did, name: `${archetype} Starter`, class: cls, archetype, cards: groupCounts(cardIds) } };
    p.activeDeckId = did;
    return { ok: true, player: p };
  }

  saveDeck(id, deck) {
    const p = this.players[id];
    if (!p) return { error: 'No player.' };
    const errs = validateDeck(deck, p.isDM ? null : p.collection, p.isDM ? null : p.class);
    if (errs.length && !p.isDM) return { error: errs.join(' ') };
    const did = deck.id || ('deck' + Date.now());
    p.decks[did] = { id: did, name: deck.name || 'Deck', class: p.class, archetype: p.archetype, cards: deck.cards };
    return { ok: true, deckId: did, warnings: p.isDM ? errs : [] };
  }
  deleteDeck(id, deckId) {
    const p = this.players[id];
    if (p && p.decks[deckId]) { delete p.decks[deckId]; if (p.activeDeckId === deckId) p.activeDeckId = Object.keys(p.decks)[0] || null; }
    return { ok: true };
  }
  setActiveDeck(id, deckId) {
    const p = this.players[id];
    if (p && p.decks[deckId]) p.activeDeckId = deckId;
    return { ok: true };
  }

  // ---- collection ops ----
  giveCards(toId, cardIds) {
    const p = this.players[toId];
    if (!p) return { error: 'No player.' };
    for (const cid of cardIds) p.collection[cid] = (p.collection[cid] || 0) + 1;
    return { ok: true };
  }
  setFavorite(id, cardId, fav) {
    const p = this.players[id];
    if (!p) return;
    p.favorites = p.favorites || [];
    if (fav && !p.favorites.includes(cardId)) p.favorites.push(cardId);
    if (!fav) p.favorites = p.favorites.filter((c) => c !== cardId);
  }

  // ---- gifting ----
  sendGift(fromId, toId, cardId) {
    const from = this.players[fromId];
    if (!from || (from.collection[cardId] || 0) < 1) return { error: 'You do not own that card.' };
    from.collection[cardId] -= 1;
    if (from.collection[cardId] <= 0) delete from.collection[cardId];
    const gift = { id: 'g' + Math.random().toString(36).slice(2, 8), fromId, toId, cardId, status: 'pending' };
    this.gifts.push(gift);
    return { ok: true, gift };
  }
  respondGift(giftId, accept) {
    const g = this.gifts.find((x) => x.id === giftId);
    if (!g || g.status !== 'pending') return { error: 'No such gift.' };
    g.status = accept ? 'accepted' : 'rejected';
    if (accept) { const to = this.players[g.toId]; if (to) to.collection[g.cardId] = (to.collection[g.cardId] || 0) + 1; }
    else { const from = this.players[g.fromId]; if (from) from.collection[g.cardId] = (from.collection[g.cardId] || 0) + 1; }
    return { ok: true };
  }

  // ---- import / export ----
  exportPlayer(id) {
    const p = this.players[id];
    if (!p) return null;
    return { kind: 'player', name: p.name, class: p.class, archetype: p.archetype, collection: p.collection, decks: p.decks, favorites: p.favorites, cardArt: p.cardArt || {} };
  }
  importPlayer(id, data) {
    const p = this.players[id];
    if (!p || !data) return { error: 'Bad import.' };
    if (data.collection) for (const [k, v] of Object.entries(data.collection)) p.collection[k] = (p.collection[k] || 0) + v;
    if (data.decks) p.decks = { ...p.decks, ...data.decks };
    if (data.class) p.class = data.class;
    if (data.archetype) p.archetype = data.archetype;
    if (data.favorites) p.favorites = data.favorites;
    if (data.cardArt) p.cardArt = data.cardArt;
    return { ok: true };
  }
  exportCampaign() {
    return {
      kind: 'campaign', code: this.code, settings: this.settings,
      dmDeck: this.dmDeck, dmDecksSaved: this.dmDecksSaved,
      art: Object.fromEntries(Object.entries(this.art).map(([id, m]) =>
        [id, { ...m, data: this.artBuf[id] ? `data:${m.mime};base64,${this.artBuf[id].toString('base64')}` : null }])),
      players: Object.fromEntries(Object.entries(this.players).map(([k, p]) => [k, this.exportPlayer(k)])),
    };
  }
  importCampaign(data) {
    if (!data || data.kind !== 'campaign') return { error: 'Not a campaign file.' };
    if (data.settings) this.settings = data.settings;
    if (data.dmDeck) this.dmDeck = data.dmDeck;
    if (data.dmDecksSaved) this.dmDecksSaved = data.dmDecksSaved;
    if (data.art) {
      for (const [id, m] of Object.entries(data.art)) {
        this.art[id] = { id, name: m.name, by: m.by, mime: m.mime };
        if (m.data) { const b = m.data.split(','); this.artBuf[id] = Buffer.from(b[1] || '', 'base64'); }
      }
    }
    if (data.players) {
      for (const [k, pd] of Object.entries(data.players)) {
        const existing = Object.values(this.players).find((x) => x.name === pd.name && !x.isDM);
        if (existing) this.importPlayer(existing.id, pd);
      }
    }
    return { ok: true };
  }

  // ---- DM encounter deck ----
  setDmDeck(cards) { this.dmDeck = cards || []; return { ok: true }; }
  saveDmDeck(name) { const id = 'enc' + Date.now(); this.dmDecksSaved[id] = { id, name, cards: this.dmDeck }; return { ok: true, id }; }

  // ---- start / end ----
  startGame() {
    const partyPlayers = Object.values(this.players).filter((p) => !p.isDM && !p.spectator);
    if (!partyPlayers.length) return { error: 'No party players.' };
    const playerSetups = [];
    for (const p of partyPlayers) {
      const deck = p.decks[p.activeDeckId] || Object.values(p.decks)[0];
      if (!deck) return { error: `${p.name} has no deck selected.` };
      const ids = [];
      for (const e of deck.cards) for (let i = 0; i < e.count; i++) ids.push(e.cardId);
      playerSetups.push({ id: p.id, name: p.name, class: p.class, archetype: p.archetype, deckCardIds: ids });
    }
    const partyHP = partyPlayers.length * 8;
    const dmHP = (DIFFICULTY_HP[this.settings.difficulty] || 10) * partyPlayers.length;
    // DM deck
    let dmIds = [];
    for (const e of this.dmDeck) for (let i = 0; i < e.count; i++) dmIds.push(e.cardId);
    if (dmIds.length < 20) dmIds = dmIds.concat(this._autoDmDeck(40 - dmIds.length));
    this.game = new GameState({ players: playerSetups, dmDeckCardIds: dmIds, partyHP, dmHP, difficulty: this.settings.difficulty });
    this.status = 'active';
    return { ok: true };
  }
  _autoDmDeck(n) {
    if (n <= 0) return [];
    // Generic filler encounter deck: DPS creatures + a few burn spells + lands.
    const pool = allCards().filter((c) =>
      (c.type === 'creature' && c.class === 'DPS' && (c.cost || 0) <= 6) ||
      ['zap', 'strike', 'fireball'].includes(c.id));
    const land = getCard('basic-land');
    const ids = [];
    // ~30% lands
    const lands = Math.ceil(n * 0.3);
    for (let i = 0; i < lands && land; i++) ids.push(land.id);
    while (ids.length < n && pool.length) {
      ids.push(pool[Math.floor(Math.random() * pool.length)].id);
    }
    return ids;
  }

  endGame(winnerSide) {
    if (this.game) this.game.declareWinner(winnerSide);
    this.status = 'ended';
    return { ok: true };
  }

  publicLobby() {
    return {
      code: this.code, status: this.status, settings: this.settings,
      dmId: this.dmId, hostId: this.hostId,
      players: Object.values(this.players).map((p) => ({
        id: p.id, name: p.name, isDM: p.isDM, class: p.class, archetype: p.archetype,
        ready: p.ready, spectator: p.spectator, connected: p.connected,
        deckCount: Object.keys(p.decks).length, activeDeckId: p.activeDeckId,
      })),
    };
  }
}

export class SessionManager {
  constructor() { this.sessions = new Map(); }
  create(hostName, asDM = true) {
    const s = new Session(hostName);
    const host = s.addPlayer({ name: hostName, isDM: asDM });
    this.sessions.set(s.code, s);
    return { session: s, player: host };
  }
  get(code) { return this.sessions.get((code || '').toUpperCase()) || null; }
  join(code, name, asDM = false) {
    const s = this.get(code);
    if (!s) return { error: 'Session not found.' };
    const player = s.addPlayer({ name, isDM: asDM });
    return { session: s, player };
  }
  cleanup() {
    for (const [code, s] of this.sessions) {
      const anyConnected = Object.values(s.players).some((p) => p.connected);
      if (!anyConnected) this.sessions.delete(code);
    }
  }
}

export { DIFFICULTY_HP };
export default SessionManager;
