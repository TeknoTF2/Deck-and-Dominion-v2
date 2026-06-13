// store.js — socket connection, global client state, card DB, helpers.
export const store = {
  socket: null,
  connected: false,
  cards: new Map(),     // id -> card
  cardList: [],
  starters: {},
  meta: { classes: [], archetypes: {}, difficulties: {}, tierWeights: {} },
  // session state (from server 'state' events)
  code: null, playerId: null, isDM: false,
  lobby: null, game: null, you: null, gifts: [], chat: [], dmDeck: [], packPreview: [],
  art: [], artSelections: {},
  // local ui
  view: 'home',          // home | lobby | collection | decks | game | dm
  listeners: [],
};

export function onChange(fn) { store.listeners.push(fn); }
export function render() { for (const fn of store.listeners) fn(); }

export function card(id) { return store.cards.get(id); }

export async function loadStatic() {
  const [cards, starters, meta] = await Promise.all([
    fetch('/api/cards').then((r) => r.json()),
    fetch('/api/starters').then((r) => r.json()),
    fetch('/api/meta').then((r) => r.json()),
  ]);
  store.cardList = cards;
  for (const c of cards) store.cards.set(c.id, c);
  store.starters = starters;
  store.meta = meta;
}

export function connect() {
  // eslint-disable-next-line no-undef
  store.socket = io();
  store.socket.on('connect', () => {
    store.connected = true;
    // try resume
    const saved = JSON.parse(localStorage.getItem('dd_session') || 'null');
    if (saved && saved.code && saved.playerId) {
      action({ type: 'resume', code: saved.code, playerId: saved.playerId }).then((r) => {
        if (r && r.ok) { applySession(r); }
        else { localStorage.removeItem('dd_session'); render(); }
      });
    } else render();
  });
  store.socket.on('disconnect', () => { store.connected = false; render(); });
  store.socket.on('state', (s) => {
    store.lobby = s.lobby; store.game = s.game; store.you = s.you;
    store.gifts = s.gifts || []; store.chat = s.chat || [];
    if (s.dmDeck !== undefined) store.dmDeck = s.dmDeck;
    if (s.packPreview !== undefined) store.packPreview = s.packPreview || [];
    store.art = s.art || []; store.artSelections = s.artSelections || {};
    // auto-route only on transitions (don't yank a player out of Collection/Decks)
    if (store.game && (store.view === 'lobby' || store.view === 'home')) store.view = 'game';
    if (!store.game && store.view === 'game') store.view = 'lobby';
    if (!store.code && s.lobby) store.code = s.lobby.code;
    render();
  });
}

export function action(msg) {
  return new Promise((resolve) => {
    if (!store.socket) return resolve({ error: 'No connection.' });
    store.socket.emit('action', msg, (resp) => resolve(resp || {}));
  });
}

export function applySession(r) {
  store.code = r.code; store.playerId = r.playerId; store.isDM = r.isDM;
  localStorage.setItem('dd_session', JSON.stringify({ code: r.code, playerId: r.playerId }));
  store.view = store.isDM ? 'lobby' : 'lobby';
  render();
}

export function leave() {
  localStorage.removeItem('dd_session');
  location.reload();
}
