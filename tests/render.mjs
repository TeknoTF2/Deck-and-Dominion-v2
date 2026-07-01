// Render the DM (and player) game view headlessly to surface client throws.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!DOCTYPE html><body><div id="toast"></div><div id="app"></div><div id="cardpop" class="hidden"></div><div id="modal-root"></div></body>', { url: 'http://localhost/' });
global.window = dom.window; global.document = dom.window.document;
global.localStorage = dom.window.localStorage; global.fetch = async () => ({ json: async () => ([]) });
global.FileReader = dom.window.FileReader;

const { store } = await import('../public/js/store.js');
const { gameView } = await import('../public/js/game.js');

// Build a minimal realistic game view (as the server's viewFor would produce for the DM)
store.code = 'TEST'; store.isDM = true; store.playerId = 'dm';
store.cards.set('hatchling', { id: 'hatchling', name: 'Hatchling', class: 'DPS', archetype: 'Swarm', set: 'Spiders', rarity: 'common', cost: 1, type: 'creature', attack: 1, health: 1, keywords: [], text: 'None' });
store.you = { id: 'dm', name: 'DM', isDM: true, class: null, archetype: null, collection: {}, decks: {}, favorites: [], cardArt: {} };
store.artSelections = {}; store.art = []; store.chat = []; store.lobby = { players: [{ id: 'p1', name: 'Aria' }] };
store.game = {
  round: 1, phase: 'play', activeId: 'p1', isDM: false, order: ['p1'], taken: [],
  partyHP: 16, partyHPMax: 16, partyShield: 0, dmHP: 16, dmHPMax: 16, dmShield: 0,
  mana: { available: 0, burst: 0 }, dmMana: { available: 0, burst: 0 },
  board: [{ instId: 'e1', cardId: 'hatchling', name: 'Hatchling', side: 'party', owner: 'p1', type: 'creature', attack: 1, health: 1, shield: 0, keywords: [], tempKeywords: [], equipment: [], poison: [], tapped: false }],
  graveyard: [], exile: [],
  players: [{ id: 'p1', name: 'Aria', class: 'DPS', archetype: 'Swarm', handCount: 7, deckCount: 23, mulligans: 0 }],
  dm: { handCount: 5, deckCount: 35 }, log: [{ t: 1, msg: 'hi', type: 'system' }], winner: null,
  suppressed: [], difficulty: 'Easy', yourHand: [{ instId: 'h1', cardId: 'hatchling', owner: 'dm' }],
  canUndo: false, canRedo: false,
  allHands: { p1: [{ instId: 'x', cardId: 'hatchling', owner: 'p1' }] }, dmHandFull: [{ instId: 'h1', cardId: 'hatchling', owner: 'dm' }],
  allDecks: { p1: [] }, dmDeckFull: [],
};

let ok = true;
try { const node = gameView(); document.getElementById('app').append(node); console.log('✓ DM gameView rendered, root class=', node.className); }
catch (e) { ok = false; console.log('✗ DM gameView THREW:\n', e.stack); }

// player view
store.isDM = false; store.playerId = 'p1';
store.you = { id: 'p1', name: 'Aria', isDM: false, class: 'DPS', archetype: 'Swarm', collection: {}, decks: {}, favorites: [], cardArt: {} };
store.game.activeId = 'p1';
try { const node = gameView(); console.log('✓ Player gameView rendered'); }
catch (e) { ok = false; console.log('✗ Player gameView THREW:\n', e.stack); }

process.exit(ok ? 0 : 1);
