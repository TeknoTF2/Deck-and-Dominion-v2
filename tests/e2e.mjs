import { io } from 'socket.io-client';
const URL = process.env.E2E_URL || 'http://localhost:3299';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mk() { const s = io(URL, { transports: ['websocket'] }); s._last = null; s.on('state', (st) => { s._last = st; }); return s; }
async function act(s, msg) { const r = await new Promise((res) => s.emit('action', msg, res)); await sleep(40); return r; }
const G = (s) => s._last && s._last.game;

let fail = 0;
function assert(c, m) { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); }

const dm = mk(), p1 = mk(), p2 = mk();
await Promise.all([dm, p1, p2].map((s) => new Promise((r) => s.on('connect', r))));

const c = await act(dm, { type: 'createSession', name: 'Gandalf', asDM: true });
assert(c.ok && c.code, 'DM created session ' + c.code);
const j1 = await act(p1, { type: 'joinSession', code: c.code, name: 'Aria' });
const j2 = await act(p2, { type: 'joinSession', code: c.code, name: 'Borin' });
assert(j1.ok && j2.ok, 'two players joined');

assert((await act(p1, { type: 'chooseClass', cls: 'DPS', archetype: 'Swarm' })).ok, 'P1 chose DPS/Swarm');
assert((await act(p2, { type: 'chooseClass', cls: 'Commander', archetype: 'Marshal' })).ok, 'P2 chose Commander/Marshal');
const dup = await act(p2, { type: 'chooseClass', cls: 'DPS', archetype: 'Big' });
assert(!!dup.error, 'duplicate class rejected');

await act(p1, { type: 'setReady', ready: true });
const collCount = Object.values(p1._last.you.collection).reduce((a, b) => a + b, 0);
assert(collCount === 30, 'P1 starter collection = 30 (' + collCount + ')');

await act(dm, { type: 'setDifficulty', difficulty: 'Easy' });
const sg = await act(dm, { type: 'startGame' });
assert(sg.ok, 'game started: ' + (sg.error || 'ok'));
assert(G(dm), 'DM receives game state');
assert(G(dm).partyHP === 16, 'party HP = 16: ' + G(dm).partyHP);
assert(G(dm).dmHP === 16, 'DM HP = 16: ' + G(dm).dmHP);
assert(G(dm).allHands, 'DM sees all hands');
assert(G(p1) && !G(p1).allHands, 'player hands redacted');
assert(G(p1).yourHand.length === 7, 'P1 hand = 7: ' + G(p1).yourHand.length);

await act(dm, { type: 'beginTurnFor', pid: j1.playerId });
assert(G(p1).activeId === j1.playerId, 'P1 is active');

await act(dm, { type: 'dmEdit', path: 'mana', value: 10 });
const cardsResp = await fetch(URL + '/api/cards').then((r) => r.json());
const cmap = Object.fromEntries(cardsResp.map((x) => [x.id, x]));
const crInst = G(p1).yourHand.find((i) => cmap[i.cardId].type === 'creature');
const pr = await act(p1, { type: 'playCard', instId: crInst.instId, targets: [] });
assert(pr.ok, 'P1 played creature ' + cmap[crInst.cardId].name + ': ' + (pr.error || 'ok'));
assert(G(p1).board.some((e) => e.side === 'party'), 'creature on party board');

const burnInst = G(p1).yourHand.find((i) => /deal \d+ damage/i.test(cmap[i.cardId].text || '') && cmap[i.cardId].type === 'spell');
if (burnInst) {
  const before = G(p1).dmHP;
  await act(p1, { type: 'playCard', instId: burnInst.instId, targets: ['dmFace'] });
  assert(G(p1).dmHP < before, 'burn reduced DM HP ' + before + '→' + G(p1).dmHP);
} else assert(true, '(no burn spell in hand — skipped)');

// combat: advance a round so creature loses summoning sickness, then attack DM face
await act(p1, { type: 'endTurn', nextId: j2.playerId });
assert(G(dm).activeId === j2.playerId, 'turn passed to P2');
await act(p2, { type: 'endTurn', nextId: 'dm' });
await act(dm, { type: 'endTurn', nextId: j1.playerId });
assert(G(p1).activeId === j1.playerId && G(p1).round === 2, 'round 2, P1 active again');
const myCreature = G(p1).board.find((e) => e.side === 'party' && e.attack > 0 && e.type === 'creature');
if (myCreature) {
  const before = G(p1).dmHP;
  const atk = await act(p1, { type: 'attack', attackerId: myCreature.instId, targetId: 'face' });
  assert(atk.ok, 'attack resolved: ' + (atk.error || 'ok'));
  assert(G(p1).dmHP <= before, 'DM HP after attack ' + before + '→' + G(p1).dmHP);
} else assert(true, '(no attacker available — skipped)');

// regression: DM ending their turn (even with nextId='dm') starts a NEW ROUND
// with a player active — it must NOT restart the DM's own turn / just tap mana.
await act(dm, { type: 'beginTurnFor', pid: 'dm' });
assert(G(dm).activeId === 'dm', 'DM turn set');
const roundBefore = G(dm).round;
await act(dm, { type: 'endTurn', nextId: 'dm' });
assert(G(dm).activeId !== 'dm', 'DM end-turn advances OFF the DM (not restart): active=' + G(dm).activeId);
assert(G(dm).round === roundBefore + 1, 'DM end-turn started a new round ' + roundBefore + '→' + G(dm).round);

const beforeHP = G(dm).dmHP;
await act(dm, { type: 'dmEdit', path: 'dmHP', value: 999 });
await act(dm, { type: 'undo' });
assert(G(dm).dmHP === beforeHP, 'DM undo restored HP');

const pack = await act(dm, { type: 'generatePack', tier: 'rare', size: 5 });
assert(pack.preview && pack.preview.length === 5, 'rare pack = 5 cards');
await act(dm, { type: 'givePack', toId: j1.playerId, cardIds: pack.preview });
const newCount = Object.values(p1._last.you.collection).reduce((a, b) => a + b, 0);
assert(newCount === 35, 'P1 collection grew to 35: ' + newCount);

// deck save/validate
const goodDeck = { id: 'd1', name: 'Test', cards: [{ cardId: 'basic-land', count: 5 }, { cardId: crInst.cardId, count: 2 }] };
const dr = await act(p1, { type: 'saveDeck', deck: goodDeck });
assert(!!dr.error, 'undersized deck rejected (validation works): ' + dr.error);

// ---- card art database ----
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const up = await fetch(URL + '/api/art/' + c.code, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Aria Hatchling', by: 'Aria', dataUrl: PNG }) }).then((r) => r.json());
assert(up.ok && up.id, 'art uploaded over HTTP, id=' + up.id);
await sleep(60);
assert((p1._last.art || []).some((a) => a.id === up.id), 'art appears in shared DB (broadcast)');
const img = await fetch(URL + '/api/art/' + c.code + '/' + up.id);
assert(img.ok && (img.headers.get('content-type') || '').startsWith('image/'), 'art served as image bytes');
await act(p1, { type: 'setCardArt', cardId: crInst.cardId, artId: up.id });
assert(p1._last.you.cardArt[crInst.cardId] === up.id, 'player selected art for their card');
assert(dm._last.artSelections[j1.playerId][crInst.cardId] === up.id, 'art selection visible to all (board owner art)');
const exp = await act(dm, { type: 'exportCampaign' });
assert(exp.data && exp.data.art && exp.data.art[up.id] && exp.data.art[up.id].data, 'campaign export embeds art bytes');

await act(dm, { type: 'declareWinner', side: 'party' });
assert(G(dm).winner === 'party', 'winner declared');

console.log('\n' + (fail ? '❌ ' + fail + ' FAILURES' : '✅ ALL E2E TESTS PASSED'));
[dm, p1, p2].forEach((s) => s.close());
process.exit(fail ? 1 : 0);
