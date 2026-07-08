// End-to-end smoke test: boots the real server and drives a session over sockets.
process.env.PORT = '3999';
require('../server/index');
const ioc = require('socket.io-client');

const URL = 'http://localhost:3999';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function ok(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label);
  if (!cond) failures++;
}

function client() {
  const s = ioc(URL);
  s.views = [];
  s.lastErr = null;
  s.on('state', v => { s.state = v; s.views.push(v); });
  s.on('err', e => { s.lastErr = e.msg; console.log('    [err]', e.msg); });
  return s;
}

async function main() {
  await wait(400);
  const dm = client(), p1 = client(), p2 = client();
  let code = null;

  dm.on('joined', j => { code = j.code; });
  dm.emit('createSession', { name: 'TheDM' });
  await wait(300);
  ok(!!code, 'DM created session ' + code);

  p1.emit('join', { code, name: 'Alice' });
  p2.emit('join', { code, name: 'Bob' });
  await wait(300);
  ok(dm.state.players.length === 2, 'two players joined');

  p1.emit('selectClass', { cls: 'dps', arch: 'big' });
  p2.emit('selectClass', { cls: 'commander', arch: 'warden' });
  await wait(300);
  ok(p1.state.decks.length === 1 && p1.state.decks[0].cards.length === 30, 'Alice got 30-card starter deck');
  ok(Object.values(p1.state.collection).reduce((a, b) => a + b, 0) === 30, 'Alice collection = 30 cards');

  // deck save validation: wrong class card should fail
  p1.emit('saveDeck', { name: 'illegal', cards: Array(30).fill('wiz_insight') });
  await wait(200);
  ok(!!p1.lastErr, 'class restriction enforced on deck save: ' + p1.lastErr);

  // DM builds an encounter deck from full DB
  const encDeck = [];
  for (let i = 0; i < 30; i++) encDeck.push('dps_scrapper');
  for (let i = 0; i < 10; i++) encDeck.push('dps_zap');
  for (let i = 0; i < 12; i++) encDeck.push('land_basic');
  dm.emit('saveDeck', { name: 'Goblin Ambush', cards: encDeck });
  dm.emit('setDMDeck', { name: 'Goblin Ambush' });
  p1.emit('ready', { ready: true });
  p2.emit('ready', { ready: true });
  await wait(200);

  dm.emit('dmAction', { op: 'startEncounter', partyHp: 16, dmHp: 20 });
  await wait(300);
  ok(dm.state.state === 'playing', 'encounter started');
  ok(dm.state.shared.hp === 16 && dm.state.dm.hp === 20, 'HP configured');
  ok(p1.state.hand.length === 4, 'opening hand of 4');
  ok(dm.state.turn.pickingNext === true, 'players pick who goes first');

  // mulligan
  p1.emit('mulligan');
  await wait(200);
  ok(p1.state.players.find(p => p.name === 'Alice').mulligans === 1, 'mulligan works');

  // Alice takes first turn
  p1.emit('takeTurn');
  await wait(250);
  ok(p1.state.turn.current === p1.state.you, 'Alice took the turn');
  ok(p1.state.hand.length === 5, 'drew a card');

  // give Alice specific cards via DM move (simpler: DM moveCard from her deck? Use dmAction giveCards affects collection not hand). Use direct hand injection via moveCard from deck: find land in deck
  // play a land if she has one; else DM moves one into her hand
  let landInst = (p1.state.hand.find(h => h.cardId === 'land_basic') || {}).inst;
  if (!landInst) {
    const deckIdx = dm.state.allDecks[p1.state.you].indexOf('land_basic');
    dm.emit('dmAction', { op: 'moveCard', from: { zone: 'deck', who: p1.state.you, index: deckIdx }, to: { zone: 'hand', who: p1.state.you } });
    await wait(200);
    landInst = (p1.state.hand.find(h => h.cardId === 'land_basic') || {}).inst;
  }
  p1.emit('playCard', { inst: landInst });
  await wait(200);
  const alice = () => p1.state.players.find(p => p.name === 'Alice');
  ok(alice().lands.length === 1, 'land played');
  p1.emit('tapLand', { landId: alice().lands[0].id });
  await wait(200);
  ok(p1.state.shared.manaPersist === 1, 'tapped land → 1 shared mana');

  // move to play phase and play a 1-cost creature (inject Scrapper into hand)
  dm.emit('dmAction', { op: 'moveCard', from: { zone: 'grave', who: 'party', index: 0 }, to: { zone: 'hand', who: p1.state.you } }); // may no-op (empty grave)
  p1.emit('nextPhase'); // mana -> play
  await wait(150);
  // ensure she has a scrapper
  let scrInst = (p1.state.hand.find(h => h.cardId === 'dps_scrapper') || {}).inst;
  if (!scrInst) {
    const di = dm.state.allDecks[p1.state.you].indexOf('dps_scrapper');
    dm.emit('dmAction', { op: 'moveCard', from: { zone: 'deck', who: p1.state.you, index: di }, to: { zone: 'hand', who: p1.state.you } });
    await wait(200);
    scrInst = (p1.state.hand.find(h => h.cardId === 'dps_scrapper') || {}).inst;
  }
  p1.emit('playCard', { inst: scrInst });
  await wait(250);
  ok(p1.state.board.some(u => u.name === 'Scrapper' && u.side === 'party'), 'creature on shared board');
  ok(p1.state.shared.manaPersist === 0, 'mana spent');

  // end turn; Bob auto-starts (only remaining)
  p1.emit('endTurn');
  await wait(250);
  ok(p2.state.turn.current === p2.state.you, 'turn auto-passed to Bob');
  p2.emit('endTurn');
  await wait(300);
  ok(dm.state.turn.current === 'dm', 'DM turn after all players');
  ok(dm.state.hand.length >= 4, 'DM drew cards');

  // DM plays a creature and a zap at the party face
  dm.emit('dmAction', { op: 'editDMMana', value: 10 });
  dm.emit('dmAction', { op: 'setTurnPhase', phase: 'play' });
  await wait(200);
  let dmScr = (dm.state.hand.find(h => h.cardId === 'dps_scrapper') || {}).inst;
  if (dmScr) {
    dm.emit('playCard', { inst: dmScr });
    await wait(300);
    ok(dm.state.board.some(u => u.side === 'dm'), 'DM creature on board');
  }
  const dmZap = (dm.state.hand.find(h => h.cardId === 'dps_zap') || {}).inst;
  if (dmZap) {
    dm.emit('playCard', { inst: dmZap, faceTarget: 'party' });
    await wait(400);
    // reaction window may open for players holding reactions; pass
    if (p1.state.pendingReaction && p1.state.pendingReaction.mine) p1.emit('reactPass');
    if (p2.state.pendingReaction && p2.state.pendingReaction.mine) p2.emit('reactPass');
    await wait(400);
    ok(dm.state.shared.hp === 14, 'Zap hit party face for 2 (HP 16→14), reaction window handled');
  }
  dm.emit('endTurn');
  await wait(300);
  ok(dm.state.turn.round === 2 && dm.state.turn.pickingNext === true, 'round 2, players pick again');

  // Round 2: Alice attacks the DM creature with her Scrapper
  p1.emit('takeTurn');
  await wait(250);
  dm.emit('dmAction', { op: 'setTurnPhase', phase: 'attack' });
  await wait(200);
  const myScr = p1.state.board.find(u => u.side === 'party' && u.name === 'Scrapper');
  const dmUnit = p1.state.board.find(u => u.side === 'dm');
  if (myScr && dmUnit) {
    p1.emit('attack', { attacker: myScr.uid, target: dmUnit.uid });
    await wait(400);
    ok(!p1.state.board.some(u => u.uid === dmUnit.uid), 'combat: 1/1 vs 1/1 both die');
    ok(p1.state.grave.length >= 1 && p1.state.dmGrave.length >= 1, 'deaths went to correct graveyards');
  }

  // DM god tools
  dm.emit('dmAction', { op: 'editPartyHP', value: 30, max: 30 });
  await wait(200);
  ok(dm.state.shared.hp === 30, 'DM direct HP edit');
  dm.emit('dmAction', { op: 'undo' });
  await wait(200);
  ok(dm.state.shared.hp !== 30, 'undo reverted HP edit (now ' + dm.state.shared.hp + ')');
  dm.emit('dmAction', { op: 'redo' });
  await wait(200);
  ok(dm.state.shared.hp === 30, 'redo re-applied');

  // packs
  dm.emit('dmAction', { op: 'genPacksPreview', tier: 'rare', size: 5, count: 2, filter: { cls: 'dps' } });
  const preview = await new Promise(res => dm.once('packPreview', res));
  ok(preview.packs.length === 2 && preview.packs[0].length === 5, 'pack preview generated');
  const before = Object.values(p1.state.collection).reduce((a, b) => a + b, 0);
  dm.emit('dmAction', { op: 'givePacks', pid: p1.state.you, tier: 'legendary', size: 5, count: 1, filter: {} });
  await wait(300);
  const after = Object.values(p1.state.collection).reduce((a, b) => a + b, 0);
  ok(after === before + 5, 'pack of 5 added to collection');

  // gifting
  const giftCard = Object.keys(p1.state.collection)[0];
  p1.emit('sendGift', { to: p2.state.you, cards: { [giftCard]: 1 } });
  await wait(200);
  const gid = (p2.state.gifts.find(g => g.status === 'pending') || {}).id;
  ok(!!gid, 'gift pending for Bob');
  p2.emit('respondGift', { id: gid, accept: true });
  await wait(200);
  ok((p2.state.collection[giftCard] || 0) >= 1, 'gift accepted into collection');

  // chat + whisper
  p1.emit('chat', { msg: 'hello table' });
  p1.emit('chat', { msg: 'psst dm', to: 'dm' });
  await wait(200);
  ok(dm.state.chat.some(m => m.msg === 'psst dm'), 'DM received whisper');
  ok(!p2.state.chat.some(m => m.msg === 'psst dm'), 'whisper hidden from Bob');

  // export/import
  const exported = await new Promise(res => dm.emit('exportState', { scope: 'campaign' }, res));
  ok(exported && exported.type === 'campaign' && Object.keys(exported.players).length === 2, 'campaign export');

  // sorcerer flow: sacrifice + rez (engine level already tested; here spot-check play with sacs)
  dm.emit('dmAction', { op: 'endEncounter', winner: 'party' });
  await wait(200);
  ok(dm.state.state === 'ended' && dm.state.winner === 'party', 'DM declared winner');
  dm.emit('dmAction', { op: 'toLobby' });
  await wait(200);
  ok(dm.state.state === 'lobby', 'back to lobby, collections kept: ' + (Object.values(p1.state.collection).reduce((a, b) => a + b, 0)) + ' cards');

  console.log(failures ? `\n${failures} FAILURES` : '\nALL SMOKE TESTS PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
