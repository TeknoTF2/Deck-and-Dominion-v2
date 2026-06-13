// dm.js — DM encounter-deck builder, pack generation, and in-game DM panel.
import { store, action, card, render } from './store.js';
import { h, mount, cardTile, toast, notify, openModal, clear } from './ui.js';

// ---------- Encounter deck builder ----------
let encFilter = { q: '', cls: '', rarity: '', type: '' };
export function renderDmDeck() {
  openModal('🃏 Encounter Deck Builder', (body) => {
    const draw = () => {
      const deck = store.dmDeck || [];
      const total = deck.reduce((s, e) => s + e.count, 0);
      let pool = store.cardList.filter((c) => {
        if (encFilter.q && !c.name.toLowerCase().includes(encFilter.q.toLowerCase())) return false;
        if (encFilter.cls && c.class !== encFilter.cls) return false;
        if (encFilter.rarity && c.rarity !== encFilter.rarity) return false;
        if (encFilter.type && c.type !== encFilter.type) return false;
        return true;
      }).sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || a.name.localeCompare(b.name)).slice(0, 200);

      const add = (id, n = 1) => { const e = deck.find((x) => x.cardId === id); if (e) e.count += n; else deck.push({ cardId: id, count: n }); store.dmDeck = deck; push(); };
      const rem = (id) => { const e = deck.find((x) => x.cardId === id); if (e) { e.count--; if (e.count <= 0) store.dmDeck = deck.filter((x) => x.cardId !== id); } push(); };
      const push = () => { action({ type: 'setDmDeck', cards: store.dmDeck }); draw(); };

      const filters = h('div', { class: 'filters' },
        h('input', { placeholder: 'Search…', value: encFilter.q, oninput: (e) => { encFilter.q = e.target.value; draw(); } }),
        h('select', { onchange: (e) => { encFilter.cls = e.target.value; draw(); } }, h('option', { value: '' }, 'All classes'), ...store.meta.classes.map((c) => h('option', { value: c, selected: encFilter.cls === c }, c))),
        h('select', { onchange: (e) => { encFilter.rarity = e.target.value; draw(); } }, h('option', { value: '' }, 'All rarities'), ...['common', 'uncommon', 'rare', 'legendary'].map((r) => h('option', { value: r, selected: encFilter.rarity === r }, r))),
        h('select', { onchange: (e) => { encFilter.type = e.target.value; draw(); } }, h('option', { value: '' }, 'All types'), ...['creature', 'spell', 'equipment', 'tower', 'persistent', 'land'].map((t) => h('option', { value: t, selected: encFilter.type === t }, t))),
      );
      const grid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', maxHeight: '46vh', overflow: 'auto' } },
        ...pool.map((c) => cardTile(c, { onClick: () => add(c.id) })));
      const list = h('div', { class: 'scroll', style: { maxHeight: '46vh' } },
        ...deck.map((e) => { const c = card(e.cardId); return c ? h('div', { class: 'deck-entry' }, h('span', { class: 'grow' }, c.name), h('span', { class: 'pill' }, '×' + e.count), h('button', { class: 'sm ghost', onclick: () => rem(c.id) }, '−'), h('button', { class: 'sm ghost', onclick: () => add(c.id) }, '+')) : null; }));

      mount(body,
        h('div', { class: 'muted' }, 'DMs build without owning cards. Recommended 100+ to avoid deckout. A generic filler deck is auto-added if under 20.'),
        filters,
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 280px', gap: '12px' } },
          grid,
          h('div', {}, h('div', { class: 'row' }, h('b', {}, 'Encounter Deck'), h('span', { class: 'pill right', style: { color: total >= 100 ? 'var(--good)' : 'var(--warn)' } }, total + ' cards')),
            list,
            h('button', { class: 'sm', style: { marginTop: '8px' }, onclick: async () => { const r = await action({ type: 'saveDmDeck', name: prompt('Encounter name?') || 'Encounter' }); notify(r, 'Saved'); } }, 'Save Encounter'))),
      );
    };
    draw();
  }, { style: { width: '900px' } });
}

// ---------- Pack generation ----------
export function packModal() {
  openModal('🎁 Pack Generation (Loot)', (body) => {
    const cfg = { tier: 'common', size: 5, filters: {}, toId: '' };
    const players = store.lobby.players.filter((p) => !p.isDM);
    const tierSel = h('select', { onchange: (e) => cfg.tier = e.target.value }, ...['common', 'uncommon', 'rare', 'legendary'].map((t) => h('option', { value: t }, t + ' pack')));
    const sizeIn = h('input', { type: 'number', value: 5, min: 1, max: 20, style: { width: '70px' }, oninput: (e) => cfg.size = +e.target.value });
    const clsSel = h('select', { onchange: (e) => cfg.filters.class = e.target.value || undefined }, h('option', { value: '' }, 'Any class'), ...store.meta.classes.map((c) => h('option', { value: c }, c)));
    const toSel = h('select', { onchange: (e) => cfg.toId = e.target.value }, h('option', { value: '' }, 'Choose player…'), ...players.map((p) => h('option', { value: p.id }, p.name)));
    const preview = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', marginTop: '10px' } });
    const gen = async () => { const r = await action({ type: 'generatePack', tier: cfg.tier, size: cfg.size, filters: cfg.filters }); if (r.preview) mount(preview, ...r.preview.map((id) => cardTile(card(id), {}))); };
    mount(body,
      h('div', { class: 'row wrap' }, h('label', {}, 'Tier'), tierSel, h('label', {}, 'Size'), sizeIn, clsSel, h('button', { class: 'primary', onclick: gen }, 'Generate Preview')),
      h('div', { class: 'muted', style: { marginTop: '6px' } }, 'Weighted by tier: each pack has 1 guaranteed slot of its tier, the rest weighted toward it with traces of higher rarity.'),
      preview,
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('label', {}, 'Give to'), toSel,
        h('button', { class: 'good', onclick: async () => {
          if (!cfg.toId) return toast('Pick a player', 'err');
          const ids = store.packPreview.map((c) => c.id);
          if (!ids.length) return toast('Generate a pack first', 'err');
          notify(await action({ type: 'givePack', toId: cfg.toId, cardIds: ids }), 'Pack given!');
        } }, 'Give Pack')),
    );
  }, { style: { width: '760px' } });
}

// ---------- Give individual cards / manage collections ----------
export function giveCardsModal() {
  openModal('Give / Manage Cards', (body) => {
    const players = store.lobby.players.filter((p) => !p.isDM);
    const state = { toId: players[0]?.id, q: '' };
    const draw = () => {
      const pool = store.cardList.filter((c) => !state.q || c.name.toLowerCase().includes(state.q.toLowerCase())).slice(0, 120);
      const grid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', maxHeight: '50vh', overflow: 'auto' } },
        ...pool.map((c) => cardTile(c, { onClick: async () => { notify(await action({ type: 'giveCard', toId: state.toId, cardId: c.id }), 'Gave ' + c.name); } })));
      mount(body,
        h('div', { class: 'row' }, h('label', {}, 'Player'), h('select', { onchange: (e) => state.toId = e.target.value }, ...players.map((p) => h('option', { value: p.id }, p.name))),
          h('input', { placeholder: 'Search…', oninput: (e) => { state.q = e.target.value; draw(); } }),
          h('button', { class: 'sm bad', onclick: () => { if (confirm('Reset this player\'s collection?')) action({ type: 'resetCollection', playerId: state.toId }); } }, 'Reset Collection'),
          h('button', { class: 'sm', onclick: () => action({ type: 'giveStarter', playerId: state.toId }) }, 'Give Starter')),
        h('div', { class: 'muted', style: { margin: '6px 0' } }, 'Click a card to add one copy to the selected player.'),
        grid);
    };
    draw();
  }, { style: { width: '820px' } });
}

// ---------- In-game DM panel ----------
export function dmGamePanel(g) {
  const editNum = (label, path, val) => h('div', { class: 'row' }, h('label', { style: { width: '90px' } }, label),
    h('input', { type: 'number', value: val, style: { width: '80px' }, onchange: (e) => action({ type: 'dmEdit', path, value: +e.target.value }) }));
  return h('div', { class: 'section col' },
    h('h3', {}, '🛡 DM Override'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'sm', disabled: !g.canUndo, onclick: () => action({ type: 'undo' }) }, '↶ Undo'),
      h('button', { class: 'sm', disabled: !g.canRedo, onclick: () => action({ type: 'redo' }) }, '↷ Redo'),
    ),
    editNum('Party HP', 'partyHP', g.partyHP),
    editNum('Party Shield', 'partyShield', g.partyShield),
    editNum('DM HP', 'dmHP', g.dmHP),
    editNum('DM Mana', 'dmMana', g.dmMana.available),
    editNum('Party Mana', 'mana', g.mana.available),
    editNum('Round', 'round', g.round),
    h('div', { class: 'row wrap' },
      h('button', { class: 'sm', onclick: packModal }, '🎁 Packs'),
      h('button', { class: 'sm', onclick: giveCardsModal }, 'Give Cards'),
      h('button', { class: 'sm', onclick: dmMoveModal }, 'Move Card'),
      h('button', { class: 'sm', onclick: dmGiveCardToGame }, 'Spawn Card'),
    ),
    h('div', { class: 'row wrap' },
      h('button', { class: 'sm', onclick: () => dmTurnModal(g) }, 'Set Turn'),
      h('button', { class: 'sm good', onclick: () => action({ type: 'declareWinner', side: 'party' }) }, 'Party Wins'),
      h('button', { class: 'sm bad', onclick: () => action({ type: 'declareWinner', side: 'dm' }) }, 'DM Wins'),
    ),
    h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Click any creature for stat/zone edits. Cards needing manual resolution are flagged gold in the log.'),
  );
}

function dmTurnModal(g) {
  openModal('Set Active Turn', (body, close) => {
    body.append(h('div', { class: 'col' },
      ...g.players.map((p) => h('button', { onclick: () => { action({ type: 'beginTurnFor', pid: p.id }); close(); } }, p.name + "'s turn")),
      h('button', { class: 'bad', onclick: () => { action({ type: 'beginTurnFor', pid: 'dm' }); close(); } }, "DM's turn")));
  });
}

function dmMoveModal() {
  openModal('Move a Card Between Zones', (body) => {
    const g = store.game;
    const zones = ['hand', 'deck', 'board', 'graveyard', 'exile'];
    const st = { from: 'graveyard', to: 'hand', owner: g.players[0]?.id || 'dm', instId: '' };
    const draw = () => {
      let items = [];
      if (st.from === 'graveyard') items = g.graveyard;
      else if (st.from === 'exile') items = g.exile;
      else if (st.from === 'board') items = g.board.map((e) => ({ instId: e.instId, cardId: e.cardId, name: e.name }));
      else if (st.from === 'hand') items = (g.allHands && g.allHands[st.owner]) || (st.owner === 'dm' ? g.dmHandFull : []) || [];
      else if (st.from === 'deck') items = (g.allDecks && g.allDecks[st.owner]) || (st.owner === 'dm' ? g.dmDeckFull : []) || [];
      const sel = h('select', { onchange: (e) => st.instId = e.target.value }, h('option', { value: '' }, 'Pick card…'),
        ...items.map((it) => h('option', { value: it.instId }, (card(it.cardId)?.name || it.name || 'Token'))));
      mount(body,
        h('div', { class: 'row wrap' },
          h('label', {}, 'From'), h('select', { onchange: (e) => { st.from = e.target.value; draw(); } }, ...zones.map((z) => h('option', { value: z, selected: st.from === z }, z))),
          h('label', {}, 'Owner'), h('select', { onchange: (e) => { st.owner = e.target.value; draw(); } }, ...g.players.map((p) => h('option', { value: p.id, selected: st.owner === p.id }, p.name)), h('option', { value: 'dm' }, 'DM')),
          h('label', {}, 'To'), h('select', { onchange: (e) => st.to = e.target.value }, ...zones.map((z) => h('option', { value: z, selected: st.to === z }, z))),
        ),
        h('div', { class: 'row', style: { marginTop: '8px' } }, sel,
          h('button', { class: 'primary', onclick: () => { if (st.instId) { action({ type: 'dmMove', instId: st.instId, from: st.from, to: st.to, ownerId: st.owner }); } } }, 'Move')));
    };
    draw();
  }, { style: { width: '600px' } });
}

function dmGiveCardToGame() {
  openModal('Spawn Card Into Game', (body) => {
    const g = store.game;
    const st = { owner: g.players[0]?.id || 'dm', zone: 'board', q: '' };
    const draw = () => {
      const pool = store.cardList.filter((c) => !st.q || c.name.toLowerCase().includes(st.q.toLowerCase())).slice(0, 80);
      mount(body,
        h('div', { class: 'row wrap' },
          h('label', {}, 'Owner'), h('select', { onchange: (e) => st.owner = e.target.value }, ...g.players.map((p) => h('option', { value: p.id }, p.name)), h('option', { value: 'dm' }, 'DM')),
          h('label', {}, 'Zone'), h('select', { onchange: (e) => st.zone = e.target.value }, ...['board', 'hand', 'deck'].map((z) => h('option', { value: z }, z))),
          h('input', { placeholder: 'Search…', oninput: (e) => { st.q = e.target.value; draw(); } })),
        h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', maxHeight: '50vh', overflow: 'auto', marginTop: '8px' } },
          ...pool.map((c) => cardTile(c, { onClick: () => { action({ type: 'dmGiveCard', cardId: c.id, ownerId: st.owner, zone: st.zone }); toast('Spawned ' + c.name); } }))));
    };
    draw();
  }, { style: { width: '820px' } });
}

export function dmEntityModal(e) {
  openModal('Edit: ' + e.name, (body) => {
    const num = (label, field, val) => h('div', { class: 'row' }, h('label', { style: { width: '70px' } }, label),
      h('input', { type: 'number', value: val, style: { width: '70px' }, onchange: (ev) => action({ type: 'dmEditEntity', instId: e.instId, field, value: +ev.target.value }) }));
    body.append(
      num('Attack', 'attack', e.attack), num('Health', 'health', e.health), num('Shield', 'shield', e.shield),
      h('div', { class: 'row wrap', style: { marginTop: '8px' } },
        ...['Haste', 'Trample', 'Deathtouch', 'Lifelink', 'First Strike', 'Taunt'].map((kw) =>
          h('button', { class: 'sm ' + (e.keywords.includes(kw) ? 'good' : ''), onclick: () => action({ type: 'dmEditEntity', instId: e.instId, field: e.keywords.includes(kw) ? 'removeKeyword' : 'addKeyword', value: kw }) }, kw))),
      h('div', { class: 'row wrap', style: { marginTop: '10px' } },
        ...['board', 'graveyard', 'exile', 'hand'].map((z) => h('button', { class: 'sm', onclick: () => action({ type: 'dmMove', instId: e.instId, from: 'board', to: z, ownerId: e.owner }) }, '→ ' + z))),
      e.cardId ? h('button', { class: 'sm', style: { marginTop: '8px' }, onclick: () => action({ type: 'dmSuppress', cardId: e.cardId }) }, 'Toggle Suppress Triggers') : null,
    );
  });
}
