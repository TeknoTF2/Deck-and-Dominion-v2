// game.js — in-game board, hand, combat/targeting interaction, side panel.
import { store, action, card, render } from './store.js';
import { h, mount, toast, notify, kwIcons, attachHover, openModal, resolveArt } from './ui.js';
import { chatPanel } from './views.js';
import { dmGamePanel, dmEntityModal } from './dm.js';

// interaction state
let ui = { mode: null, attacker: null, playInst: null };
function resetUi() { ui = { mode: null, attacker: null, playInst: null }; }

export function gameView() {
  const g = store.game;
  if (!g) return h('div', { class: 'content' }, 'No game.');
  const youSide = store.isDM ? 'dm' : 'party';
  const enemySide = youSide === 'dm' ? 'party' : 'dm';
  const myId = store.isDM ? 'dm' : store.playerId;
  const myTurn = g.activeId === myId;

  if (g.winner) return endScreen(g);

  const main = h('div', { class: 'board-shell' },
    faceRow(g, enemySide, true),
    h('div', { class: 'zones' },
      battlefield(g, 'dm', youSide === 'dm'),
      battlefield(g, 'party', youSide === 'party'),
    ),
    faceRow(g, youSide, false),
  );

  const side = h('div', { class: 'sidepanel' },
    turnPanel(g, myId, myTurn),
    store.isDM ? dmGamePanel(g) : null,
    logBox(g),
    chatPanel(),
  );

  const wrap = h('div', { class: 'content', style: { paddingBottom: '4px' } },
    h('div', { class: 'gamewrap' }, h('div', { class: 'col', style: { minHeight: 0 } }, main, handTray(g, myId, myTurn)), side),
    ui.mode ? h('div', { class: 'targeting-banner', onclick: resetThenRender }, ui.mode === 'attack' ? 'Select a target to attack — (click here to cancel)' : 'Select a target for the card — (click to cancel)') : null,
  );
  return wrap;
}
function resetThenRender() { resetUi(); render(); }

function faceRow(g, side, isEnemy) {
  const isDM = side === 'dm';
  const hp = isDM ? g.dmHP : g.partyHP, max = isDM ? g.dmHPMax : g.partyHPMax;
  const shield = isDM ? g.dmShield : g.partyShield;
  const mana = isDM ? g.dmMana : g.mana;
  const showMana = (side === 'dm') === store.isDM || store.isDM; // you see your mana; DM sees both
  const faceEl = h('div', { class: 'face ' + side, onclick: () => onFaceClick(side) },
    h('b', {}, isDM ? '🐉 Dungeon Master' : '🛡 The Party'),
    h('div', { class: 'hpbar' }, h('div', { style: { width: Math.max(0, hp / max * 100) + '%' } })),
    h('span', { class: 'stat-chip' }, '❤ ' + hp + ' / ' + max),
    shield > 0 ? h('span', { class: 'stat-chip', style: { color: 'var(--accent)' } }, '🛡 ' + shield) : null,
    showMana ? h('span', { class: 'stat-chip mana-chip' }, '◆ ' + mana.available + (mana.burst ? ' (+' + mana.burst + ' burst)' : '')) : null,
    (ui.mode && isEnemy) ? h('span', { class: 'pill targetable', style: { background: 'var(--good)' } }, 'attack face ▶') : null,
  );
  if (ui.mode && isEnemy) faceEl.classList.add('targetable');
  return faceEl;
}

function battlefield(g, side, isYou) {
  const ents = g.board.filter((e) => e.side === side);
  const lane = h('div', { class: 'battlefield ' + side + '-side' },
    ents.length ? null : h('span', { class: 'muted' }, side === 'dm' ? 'DM has no creatures' : 'No party creatures'),
    ...ents.map((e) => entityEl(g, e, isYou)));
  return h('div', {}, h('div', { class: 'zone-label' }, (side === 'dm' ? 'DM Battlefield' : 'Party Battlefield') + (isYou ? ' (you)' : '')), lane);
}

function entityEl(g, e, isYou) {
  const c = e.cardId ? card(e.cardId) : null;
  const targetable = ui.mode && isTargetable(g, e);
  const art = e.cardId ? resolveArt(e.cardId, {}, e.owner) : null;
  const el = h('div', { class: 'ent' + (e.tapped ? ' tapped' : '') + (ui.attacker === e.instId ? ' selected' : '') + (targetable ? ' targetable' : '') + (art ? ' has-art' : '') },
    art ? h('div', { class: 'ent-art', style: { backgroundImage: `url("${art}")` } }) : null,
    e.shield > 0 ? h('div', { class: 'shield-b' }, e.shield) : null,
    (e.poison && e.poison.length) ? h('div', { class: 'poison-b' }, '☣') : null,
    h('div', { class: 'en' }, e.name),
    kwIcons([...(e.keywords || []), ...(e.tempKeywords || []).map((t) => t.kw)]),
    h('div', { class: 'es' }, h('span', { class: 'atk' }, '⚔' + e.attack), h('span', { class: 'hp' }, '❤' + e.health)),
    (e.equipment && e.equipment.length) ? h('div', { class: 'eq' }, '🔧' + e.equipment.length) : null,
  );
  if (c) attachHover(el, c);
  el.addEventListener('click', (ev) => { ev.stopPropagation(); onEntityClick(g, e, isYou); });
  return el;
}

function isTargetable(g, e) {
  if (ui.mode === 'attack') { const enemy = store.isDM ? 'party' : 'dm'; return e.side === enemy && e.type !== 'land'; }
  if (ui.mode === 'play-target') return true; // any creature can be a target; server validates intent
  return false;
}

function onEntityClick(g, e, isYou) {
  const myId = store.isDM ? 'dm' : store.playerId;
  if (ui.mode === 'attack') {
    if (e.instId === ui.attacker) { resetUi(); return render(); }
    action({ type: 'attack', attackerId: ui.attacker, targetId: e.instId }).then((r) => notify(r));
    resetUi(); return;
  }
  if (ui.mode === 'play-target') {
    action({ type: 'playCard', instId: ui.playInst, targets: [e.instId] }).then((r) => { notify(r); });
    resetUi(); return;
  }
  // no mode:
  if (store.isDM) return dmEntityModal(e);
  // your creature → maybe start attack
  if (e.side === 'party' && e.owner === myId || (e.side === 'party')) {
    if (g.activeId !== myId) return toast('Not your turn.', 'err');
    if (e.type === 'land' || e.type === 'tower') return;
    if (e.attack <= 0) return toast('This has 0 attack.', 'err');
    ui = { mode: 'attack', attacker: e.instId, playInst: null };
    return render();
  }
}

function onFaceClick(side) {
  if (ui.mode === 'attack') {
    const enemy = store.isDM ? 'party' : 'dm';
    if (side !== enemy) return;
    action({ type: 'attack', attackerId: ui.attacker, targetId: 'face' }).then((r) => notify(r));
    resetUi(); return;
  }
  if (ui.mode === 'play-target') {
    const tgt = side === 'dm' ? 'dmFace' : 'partyFace';
    action({ type: 'playCard', instId: ui.playInst, targets: [tgt] }).then((r) => notify(r));
    resetUi();
  }
}

function handTray(g, myId, myTurn) {
  const hand = g.yourHand || [];
  const mana = store.isDM ? g.dmMana : g.mana;
  const avail = mana.available + mana.burst;
  const cards = hand.map((inst) => {
    const c = card(inst.cardId);
    if (!c) return null;
    const isReaction = /^reaction:/i.test(c.text || '');
    const affordable = (c.cost || 0) <= avail || store.isDM;
    const playable = (myTurn || isReaction || store.isDM) && (affordable || c.type === 'land');
    const art = resolveArt(c.id, {});
    const el = h('div', { class: 'hcard' + (playable ? ' playable' : '') + (art ? ' has-art' : '') },
      art ? h('div', { class: 'card-art', style: { backgroundImage: `url("${art}")` } }) : null,
      h('div', { class: 'row', style: { justifyContent: 'space-between' } },
        h('span', { class: 'cost' }, c.cost ?? '–'),
        c.attack != null ? h('b', {}, c.attack + '/' + c.health) : h('span', { class: 'pill' }, c.type)),
      h('div', { style: { fontWeight: 650, fontSize: '11.5px', marginTop: '4px' } }, c.name),
      h('div', { class: 'ht' }, c.text || ''),
      isReaction ? h('span', { class: 'pill', style: { color: 'var(--gold)' } }, 'Reaction') : null,
    );
    attachHover(el, c);
    el.addEventListener('click', () => onPlayHand(g, inst, c, playable));
    return el;
  }).filter(Boolean);
  return h('div', { class: 'hand-tray' }, cards.length ? cards : h('span', { class: 'muted' }, 'Hand is empty'));
}

function needsTarget(c) {
  if (c.type === 'equipment') return true;
  const t = (c.text || '').toLowerCase();
  if (/all (enemy|friendly|creatures)/.test(t)) return false;
  return /\btarget\b/.test(t) || (c.type === 'spell' && /deal \d+ damage/.test(t));
}

function onPlayHand(g, inst, c, playable) {
  if (!playable) return toast('Cannot play this now.', 'err');
  if (needsTarget(c)) {
    ui = { mode: 'play-target', attacker: null, playInst: inst.instId };
    toast('Select a target for ' + c.name, '');
    return render();
  }
  action({ type: 'playCard', instId: inst.instId, targets: [] }).then((r) => notify(r));
}

function turnPanel(g, myId, myTurn) {
  const phases = ['draw', 'mana', 'play', 'attack', 'resolution'];
  const activeName = g.activeId === 'dm' ? 'DM' : (g.players.find((p) => p.id === g.activeId)?.name || '?');
  const nextPick = h('select', {}, ...g.players.filter((p) => !g.taken.includes(p.id) && p.id !== g.activeId).map((p) => h('option', { value: p.id }, '→ ' + p.name)), h('option', { value: 'dm' }, '→ DM'));
  return h('div', { class: 'section col' },
    h('div', { class: 'row' }, h('b', {}, 'Round ' + g.round), h('span', { class: 'pill right' }, myTurn ? 'Your turn' : activeName + "'s turn")),
    h('div', { class: 'phasebar' }, ...phases.map((p) => h('span', { class: 'phase-step' + (g.phase === p ? ' on' : '') }, p))),
    (myTurn || store.isDM) ? h('div', { class: 'row wrap' },
      h('button', { class: 'sm', onclick: () => action({ type: 'nextPhase' }) }, 'Next Phase ▸'),
      h('button', { class: 'sm', onclick: () => action({ type: 'drawCard', n: 1 }) }, 'Draw'),
      g.round === 1 && (g.yourHand && (g.players.find(p => p.id === myId)?.mulligans ?? 0) < 2) ? h('button', { class: 'sm', onclick: () => action({ type: 'mulligan' }) }, 'Mulligan') : null,
    ) : null,
    (myTurn || store.isDM) ? h('div', { class: 'row' },
      nextPick,
      h('button', { class: 'primary grow', onclick: () => action({ type: 'endTurn', nextId: nextPick.value }) }, 'End Turn'),
    ) : null,
    h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Click your creature → click a target/face to attack. Click a hand card to play.'),
  );
}

function logBox(g) {
  const box = h('div', { class: 'logbox' }, ...(g.log || []).map((l) => h('div', { class: 'logline ' + (l.type || '') }, l.msg)));
  setTimeout(() => { box.scrollTop = box.scrollHeight; }, 0);
  return h('div', { style: { flex: '1', minHeight: '120px', display: 'flex', flexDirection: 'column' } }, h('div', { class: 'zone-label' }, 'Combat Log'), box);
}

function endScreen(g) {
  const win = g.winner === (store.isDM ? 'dm' : 'party');
  return h('div', { class: 'content center', style: { paddingTop: '12vh' } },
    h('div', { style: { fontSize: '54px' } }, g.winner === 'party' ? '🏆' : '💀'),
    h('h1', {}, g.winner === 'party' ? 'The Party is Victorious!' : 'The Dungeon Master Prevails'),
    h('p', { class: 'muted' }, win ? 'Victory!' : 'Defeat — but the campaign continues.'),
    store.isDM ? h('button', { class: 'primary', onclick: () => action({ type: 'returnToLobby' }) }, 'Return to Lobby') : h('p', { class: 'muted' }, 'Waiting for the DM…'),
  );
}

