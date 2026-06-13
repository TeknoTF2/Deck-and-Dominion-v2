// Render the live board UI to a standalone HTML preview (open in any browser).
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const dom = new JSDOM('<!DOCTYPE html><body><div id="toast"></div><div id="app"></div><div id="cardpop" class="hidden"></div><div id="modal-root"></div></body>', { url: 'http://localhost/' });
global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;
global.fetch = async () => ({ json: async () => ([]) }); global.FileReader = dom.window.FileReader;

const { store } = await import('../public/js/store.js');
for (const c of JSON.parse(fs.readFileSync('data/cards.json'))) store.cards.set(c.id, c);
const { gameView } = await import('../public/js/game.js');

let n = 1; const id = () => 'e' + (n++);
const cre = (cardId, name, side, owner, attack, health, extra = {}) => ({
  instId: id(), cardId, name, side, owner, type: 'creature', attack, health, shield: 0,
  keywords: [], tempKeywords: [], equipment: [], poison: [], tapped: false, ...extra,
});
const land = (owner, side, tapped) => ({ instId: id(), cardId: 'basic-land', name: 'Basic Land', side, owner, type: 'land', attack: 0, health: 1, shield: 0, keywords: [], tempKeywords: [], equipment: [], poison: [], tapped });

store.code = 'DEMO'; store.isDM = false; store.playerId = 'p1';
store.you = { id: 'p1', name: 'Aria', isDM: false, class: 'DPS', archetype: 'Swarm', collection: {}, decks: {}, favorites: [], cardArt: {} };
store.artSelections = {}; store.art = []; store.chat = [{ fromName: 'Borin', text: 'Watch the taunt!' }];
store.lobby = { players: [{ id: 'p1', name: 'Aria' }, { id: 'p2', name: 'Borin' }, { id: 'p3', name: 'Cael' }] };
store.game = {
  round: 3, phase: 'play', activeId: 'p1', isDM: false, order: ['p1', 'p2', 'p3'], taken: [],
  partyHP: 21, partyHPMax: 24, partyShield: 3, dmHP: 34, dmHPMax: 50, dmShield: 0,
  mana: { available: 4, burst: 2 }, dmMana: { available: 0, burst: 0 },
  players: [
    { id: 'p1', name: 'Aria', class: 'DPS', archetype: 'Swarm', handCount: 4, deckCount: 18, mulligans: 0 },
    { id: 'p2', name: 'Borin', class: 'Commander', archetype: 'Warden', handCount: 5, deckCount: 20, mulligans: 0 },
    { id: 'p3', name: 'Cael', class: 'Sorcerer', archetype: 'Necromancer', handCount: 3, deckCount: 22, mulligans: 0 },
  ],
  board: [
    cre('hatchling', 'Hatchling', 'party', 'p1', 1, 1), cre('venomfang', 'Venomfang', 'party', 'p1', 1, 1, { keywords: ['Poison 1'], poison: [] }),
    cre('cave-spider', 'Cave Spider', 'party', 'p1', 2, 2, { tapped: true }), land('p1', 'party', false), land('p1', 'party', true), land('p1', 'party', false),
    cre('healing-tower', 'Healing Tower', 'party', 'p2', 0, 1, { type: 'tower' }), cre('squire', 'Squire', 'party', 'p2', 1, 2, { shield: 3 }), land('p2', 'party', false), land('p2', 'party', false),
    cre('skeleton', 'Skeleton', 'party', 'p3', 1, 1), cre('bone-colossus', 'Bone Colossus', 'party', 'p3', 4, 6, { keywords: ['Trample'] }), land('p3', 'party', true),
    cre('ogre-warlord', 'Ogre Warlord', 'dm', 'dm', 6, 6, { keywords: ['Taunt'] }), cre('ogre-thug', 'Ogre Thug', 'dm', 'dm', 3, 4), land('dm', 'dm', false), land('dm', 'dm', false),
  ],
  graveyard: [], exile: [], dm: { handCount: 6, deckCount: 41 },
  log: [
    { msg: '— Aria\'s turn (round 3) —', type: 'system' }, { msg: 'Aria taps lands for 2 mana.', type: 'info' },
    { msg: 'Bone Colossus attacks Ogre Thug for 4.', type: 'combat' }, { msg: 'Ogre Thug dies.', type: 'death' },
    { msg: 'Party restores 3 HP (HP 21).', type: 'heal' }, { msg: '↳ Mass Revival — resolve manually (DM).', type: 'manual' },
  ],
  winner: null, suppressed: [], difficulty: 'Medium', yourHand: [
    { instId: 'h1', cardId: 'fireball', owner: 'p1' }, { instId: 'h2', cardId: 'brood-mother', owner: 'p1' },
    { instId: 'h3', cardId: 'zap', owner: 'p1' }, { instId: 'h4', cardId: 'venomfang', owner: 'p1' },
  ], canUndo: true, canRedo: false,
};

const board = gameView();
const css = fs.readFileSync('public/css/styles.css', 'utf8');
const topbar = `<div class="topbar"><div class="brand">Deck <span class="amp">&amp;</span> Dominion</div>
<div class="tabs"><div class="tab">🏰 Lobby</div><div class="tab">📚 Collection</div><div class="tab">🛠 Decks</div><div class="tab active">⚔ Battle</div></div>
<div class="right row"><span class="pill">Session DEMO</span><span class="pill cls-DPS">Aria · DPS</span></div></div>`;
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Board preview</title><style>${css}
html,body{height:100%} #wrap{height:100vh;display:flex;flex-direction:column}</style></head>
<body><div id="wrap">${topbar}${board.outerHTML}</div></body></html>`;
fs.writeFileSync('preview_board.html', html);
console.log('Wrote preview_board.html (', html.length, 'bytes )');
