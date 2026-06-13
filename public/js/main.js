// main.js — app shell, top navigation, routing, gift prompts.
import { store, onChange, render, connect, loadStatic, leave, action } from './store.js';
import { h, mount, toast, openModal } from './ui.js';
import { homeView, lobbyView, collectionView, decksView, cardDetailModal } from './views.js';
import { gameView } from './game.js';
import { card } from './store.js';

const app = document.getElementById('app');

function topbar() {
  const tabs = [];
  const inGame = store.game && !store.game.winner;
  const add = (id, label, show = true) => { if (show) tabs.push(h('div', { class: 'tab' + (store.view === id ? ' active' : ''), onclick: () => { store.view = id; render(); } }, label)); };
  add('lobby', '🏰 Lobby');
  add('collection', '📚 Collection', !!store.you?.class || store.isDM);
  add('decks', '🛠 Decks', !!store.you?.class || store.isDM);
  add('game', '⚔ Battle', !!store.game);

  return h('div', { class: 'topbar' },
    h('div', { class: 'brand' }, 'Deck ', h('span', { class: 'amp' }, '&'), ' Dominion'),
    h('div', { class: 'tabs' }, ...tabs),
    h('div', { class: 'right row' },
      store.code ? h('span', { class: 'pill' }, 'Session ' + store.code) : null,
      store.you ? h('span', { class: 'pill ' + (store.isDM ? '' : 'cls-' + store.you.class) }, store.you.name + (store.isDM ? ' (DM)' : store.you.class ? ' · ' + store.you.class : '')) : null,
      h('span', { class: 'dot ' + (store.connected ? 'on' : '') }, ''),
      h('button', { class: 'sm ghost', onclick: leave }, 'Leave'),
    ),
  );
}

function giftPrompts() {
  // show incoming pending gifts addressed to me
  const incoming = (store.gifts || []).filter((g) => g.toId === store.playerId && g.status === 'pending');
  if (!incoming.length) return;
  // render one prompt at a time
  const g = incoming[0];
  const c = card(g.cardId);
  if (document.getElementById('gift-modal-open')) return;
  const marker = h('div', { id: 'gift-modal-open' });
  document.body.append(marker);
  openModal('🎁 Incoming Gift', (body, close) => {
    const from = (store.lobby?.players || []).find((p) => p.id === g.fromId);
    body.append(
      h('p', {}, (from?.name || 'Someone') + ' wants to send you:'),
      h('div', { style: { fontWeight: 700, fontSize: '16px', margin: '6px 0' } }, c?.name || g.cardId),
      h('p', { class: 'muted' }, c?.text || ''),
      h('div', { class: 'row' },
        h('button', { class: 'good grow', onclick: () => { action({ type: 'respondGift', giftId: g.id, accept: true }); marker.remove(); close(); } }, 'Accept'),
        h('button', { class: 'bad', onclick: () => { action({ type: 'respondGift', giftId: g.id, accept: false }); marker.remove(); close(); } }, 'Reject'),
      ),
    );
  }, { dismissable: false });
}

function route() {
  if (!store.code) return homeView();
  let body;
  switch (store.view) {
    case 'collection': body = collectionView(); break;
    case 'decks': body = decksView(); break;
    case 'game': body = store.game ? gameView() : lobbyView(); break;
    case 'lobby':
    default: body = lobbyView(); break;
  }
  return h('div', { class: 'app-shell' }, topbar(), body);
}

function draw() {
  try {
    mount(app, route());
    giftPrompts();
  } catch (e) {
    console.error('Render error:', e);
    mount(app, h('div', { class: 'content' },
      h('h2', {}, 'Something went wrong rendering the screen'),
      h('pre', { class: 'muted', style: { whiteSpace: 'pre-wrap' } }, String(e && e.stack || e)),
      h('button', { class: 'primary', onclick: () => { store.view = store.game ? 'game' : 'lobby'; draw(); } }, 'Retry'),
      h('button', { onclick: () => location.reload() }, 'Reload'),
    ));
  }
}

onChange(draw);

(async function boot() {
  try { await loadStatic(); } catch (e) { toast('Failed to load card database', 'err'); }
  connect();
  draw();
})();
