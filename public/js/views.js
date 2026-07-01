// views.js — home, lobby, collection, deck builder.
import { store, action, applySession, card, render } from './store.js';
import { h, mount, cardTile, toast, notify, openModal, clear } from './ui.js';
import { renderDmDeck } from './dm.js';
import { openArtPicker } from './art.js';

export function homeView() {
  const name = h('input', { placeholder: 'Your name', value: localStorage.getItem('dd_name') || '' });
  const code = h('input', { placeholder: 'Session code', style: { textTransform: 'uppercase' } });
  const save = () => localStorage.setItem('dd_name', name.value);
  return h('div', { class: 'home col' },
    h('div', { class: 'brand', style: { fontSize: '34px', textAlign: 'center', marginBottom: '6px' } }, 'Deck ', h('span', { class: 'amp' }, '&'), ' Dominion'),
    h('div', { class: 'muted center', style: { marginBottom: '14px' } }, 'A cooperative deck-building TTRPG. The cards are real.'),
    h('div', { class: 'card-panel col' },
      h('label', { class: 'muted' }, 'Display name'), name,
      h('div', { class: 'row' },
        h('button', { class: 'primary grow', onclick: async () => {
          save();
          const r = await action({ type: 'createSession', name: name.value || 'DM', asDM: true });
          if (r.error) return toast(r.error, 'err');
          applySession(r); toast('Session ' + r.code + ' created — you are the DM.', 'ok');
        } }, '🛡 Create Session (as DM)'),
      ),
      h('div', { class: 'row', style: { marginTop: '6px' } }, h('div', { class: 'grow', style: { borderTop: '1px solid var(--line)' } }), h('span', { class: 'muted' }, 'or join'), h('div', { class: 'grow', style: { borderTop: '1px solid var(--line)' } })),
      code,
      h('div', { class: 'row' },
        h('button', { class: 'grow', onclick: () => join(name, code, false) }, '⚔ Join as Player'),
        h('button', { class: 'ghost', onclick: () => join(name, code, true) }, 'Join as co-DM'),
      ),
    ),
    h('div', { class: 'muted center', style: { marginTop: '10px', fontSize: '12px' } }, store.cardList.length + ' cards loaded across 5 classes, 15 archetypes.'),
  );
}
async function join(name, code, asDM) {
  localStorage.setItem('dd_name', name.value);
  const r = await action({ type: 'joinSession', code: (code.value || '').toUpperCase(), name: name.value || 'Player', asDM });
  if (r.error) return toast(r.error, 'err');
  applySession(r);
}

// ---------- LOBBY ----------
export function lobbyView() {
  const lobby = store.lobby; const you = store.you;
  if (!lobby) return h('div', { class: 'content' }, 'Loading…');
  const isDM = store.isDM;
  const partyPlayers = lobby.players.filter((p) => !p.isDM);

  const left = h('div', { class: 'col grow' },
    h('div', { class: 'section' },
      h('div', { class: 'row' },
        h('h2', {}, 'Lobby '), h('span', { class: 'pill', style: { fontSize: '15px' } }, 'Code: ' + lobby.code),
        h('button', { class: 'sm ghost right', onclick: () => { navigator.clipboard?.writeText(lobby.code); toast('Code copied'); } }, 'Copy'),
      ),
      h('div', { class: 'muted' }, 'Share the code so others can join. ' + (isDM ? 'You are the Dungeon Master.' : '')),
    ),
    h('div', { class: 'section' },
      h('h3', {}, 'Players (' + partyPlayers.length + ')'),
      h('div', { class: 'col' }, ...lobby.players.map((p) => playerRow(p, isDM))),
    ),
    !you.isDM ? classPicker() : null,
  );

  const right = h('div', { class: 'col', style: { width: '320px' } },
    isDM ? dmLobbyPanel(lobby) : readyPanel(you),
    chatPanel(),
  );
  return h('div', { class: 'content', style: { display: 'flex', gap: '14px', alignItems: 'flex-start' } }, left, right);
}

function playerRow(p, isDM) {
  return h('div', { class: 'player-row' },
    h('span', { class: 'dot ' + (p.connected ? 'on' : '') }),
    h('b', {}, p.name), p.isDM ? h('span', { class: 'pill' }, 'DM') : null,
    p.class ? h('span', { class: 'class-tag cls-' + p.class }, p.class + (p.archetype ? ' · ' + p.archetype : '')) : h('span', { class: 'muted' }, 'choosing…'),
    p.ready ? h('span', { class: 'pill', style: { color: 'var(--good)' } }, '✓ Ready') : null,
    p.spectator ? h('span', { class: 'pill' }, 'Spectator') : null,
    (isDM && !p.isDM) ? h('button', { class: 'sm ghost right', onclick: () => action({ type: 'kickPlayer', playerId: p.id }) }, 'Kick') : null,
  );
}

function classPicker() {
  const you = store.you;
  const cls = you.class || 'Commander';
  const sel = h('select', { onchange: () => renderArch() }, ...store.meta.classes.map((c) => h('option', { value: c, selected: c === cls }, c)));
  const archWrap = h('div', { class: 'row wrap' });
  const renderArch = () => {
    mount(archWrap, ...store.meta.archetypes[sel.value].map((a) =>
      h('button', { class: you.archetype === a && you.class === sel.value ? 'primary' : '', onclick: async () => {
        const r = await action({ type: 'chooseClass', cls: sel.value, archetype: a });
        notify(r, r.ok ? `You are a ${sel.value} (${a}). Starter deck granted.` : null);
      } }, a)));
  };
  renderArch();
  return h('div', { class: 'section' },
    h('h3', {}, 'Choose your Class & Archetype'),
    h('div', { class: 'muted', style: { marginBottom: '8px' } }, 'Each class owns a mechanical space. Picking grants a 30-card starter deck + collection.'),
    h('div', { class: 'row' }, h('label', {}, 'Class'), sel),
    h('div', { style: { marginTop: '8px' } }, archWrap),
    you.class ? h('div', { class: 'pill', style: { marginTop: '10px' } }, `Current: ${you.class} · ${you.archetype}`) : null,
  );
}

function readyPanel(you) {
  return h('div', { class: 'section col' },
    h('h3', {}, 'Get Ready'),
    h('div', { class: 'muted' }, you.class ? 'Pick a deck in the Decks tab, then ready up.' : 'Choose a class & archetype first.'),
    h('div', { class: 'row' },
      h('button', { class: you.ready ? 'good' : 'primary', disabled: !you.class, onclick: () => action({ type: 'setReady', ready: !you.ready }) }, you.ready ? '✓ Ready (click to unready)' : 'Ready Up'),
    ),
    h('div', { class: 'row' },
      h('label', { class: 'muted' }, h('input', { type: 'checkbox', checked: you.spectator, onchange: (e) => action({ type: 'setSpectator', spectator: e.target.checked }) }), ' Spectate only'),
    ),
  );
}

function dmLobbyPanel(lobby) {
  const diffSel = h('select', { onchange: (e) => action({ type: 'setDifficulty', difficulty: e.target.value }) },
    ...Object.keys(store.meta.difficulties).map((d) => h('option', { value: d, selected: lobby.settings.difficulty === d }, `${d} (${store.meta.difficulties[d]} HP/player)`)));
  // readiness: who can actually battle
  const party = lobby.players.filter((p) => !p.isDM && !p.spectator);
  const noDeck = party.filter((p) => !p.class);
  const canStart = party.length > 0 && noDeck.length === 0;
  return h('div', { class: 'section col' },
    h('h3', {}, '🛡 DM Controls'),
    h('div', { class: 'row' }, h('label', {}, 'Difficulty'), diffSel),
    h('button', { onclick: openDmDeckModal }, '🃏 Build Encounter Deck (' + store.dmDeck.reduce((s, e) => s + e.count, 0) + ' cards)'),
    // explicit readiness feedback so the DM knows why Start may be blocked
    h('div', { class: 'muted', style: { fontSize: '12px' } },
      party.length === 0 ? '⚠ No party players yet — at least one non-spectator must join.' :
      noDeck.length ? `⚠ Waiting on: ${noDeck.map((p) => p.name).join(', ')} (must pick a class/archetype).` :
      `✓ ${party.length} player(s) ready to battle.`),
    h('button', { class: 'primary', disabled: !canStart, onclick: async () => {
      const r = await action({ type: 'startGame' });
      if (r.error) { openModal('Cannot start encounter', (b) => b.append(h('p', {}, r.error), h('p', { class: 'muted' }, 'Every non-spectator player must choose a class & archetype (which grants a starter deck) before the battle can begin.'))); return; }
      store.view = 'game'; render(); toast('Encounter started!', 'ok');
    } }, '▶ Start Encounter'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'sm', onclick: exportCampaign }, 'Export Campaign'),
      h('button', { class: 'sm', onclick: importCampaign }, 'Import Campaign'),
    ),
    h('div', { class: 'muted', style: { fontSize: '12px' } }, `Party HP will be ${party.length * 8}. DM HP scales with difficulty × party size. A filler encounter deck is auto-added at battle start if yours is under 20 cards.`),
  );
}

export function chatPanel() {
  const input = h('input', { placeholder: 'Message…  (/w name for whisper)', class: 'grow' });
  const send = () => {
    let text = input.value.trim(); if (!text) return;
    let whisperTo = null;
    const m = text.match(/^\/w\s+(\S+)\s+(.*)/);
    if (m) { const t = (store.lobby?.players || []).find((p) => p.name.toLowerCase() === m[1].toLowerCase()); if (t) { whisperTo = t.id; text = m[2]; } }
    action({ type: 'chat', text, whisperTo }); input.value = '';
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  const log = h('div', { class: 'chatlog' }, ...store.chat.map((c) =>
    h('div', { class: 'chatline' }, c.whisperTo ? h('span', { class: 'pill', style: { color: 'var(--gold)' } }, 'whisper') : null, ' ', h('b', {}, c.fromName + ':'), ' ', c.text)));
  setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);
  return h('div', { class: 'chatbox' }, h('div', { class: 'zone-label' }, 'Chat'), log, h('div', { class: 'row', style: { marginTop: '6px' } }, input, h('button', { class: 'sm', onclick: send }, 'Send')));
}

// ---------- COLLECTION ----------
let colFilter = { q: '', rarity: '', type: '', sort: 'cost', favOnly: false };
export function collectionView() {
  const you = store.you;
  const coll = you.collection || {};
  const entries = Object.entries(coll).map(([id, n]) => ({ c: card(id), n })).filter((x) => x.c);
  const totalCards = entries.reduce((s, e) => s + e.n, 0);
  const byRarity = {};
  for (const e of entries) byRarity[e.c.rarity] = (byRarity[e.c.rarity] || 0) + e.n;

  const filtered = entries.filter(({ c }) => {
    if (colFilter.q && !c.name.toLowerCase().includes(colFilter.q.toLowerCase()) && !(c.text || '').toLowerCase().includes(colFilter.q.toLowerCase())) return false;
    if (colFilter.rarity && c.rarity !== colFilter.rarity) return false;
    if (colFilter.type && c.type !== colFilter.type) return false;
    if (colFilter.favOnly && !(you.favorites || []).includes(c.id)) return false;
    return true;
  }).sort(sorter(colFilter.sort));

  const grid = h('div', { class: 'grid' }, ...filtered.map(({ c, n }) =>
    cardTile(c, { count: n, fav: (you.favorites || []).includes(c.id), onClick: () => cardDetailModal(c) })));

  return h('div', { class: 'content' },
    h('div', { class: 'section row wrap' },
      h('div', {}, h('div', { class: 'kpi' }, totalCards), h('div', { class: 'muted' }, 'cards owned')),
      h('div', {}, h('div', { class: 'kpi' }, entries.length), h('div', { class: 'muted' }, 'unique')),
      ...['common', 'uncommon', 'rare', 'legendary'].map((r) => h('div', {}, h('div', { class: 'kpi', style: { color: `var(--${r})` } }, byRarity[r] || 0), h('div', { class: 'muted' }, r))),
      h('button', { class: 'right', onclick: () => openArtPicker() }, '🎨 Art Database'),
    ),
    filterBar(() => render()),
    entries.length ? grid : h('div', { class: 'muted center', style: { padding: '40px' } }, 'No cards yet. Choose a class to receive your starter collection.'),
  );
}

function sorter(key) {
  return (a, b) => {
    if (key === 'name') return a.c.name.localeCompare(b.c.name);
    if (key === 'rarity') { const o = ['common', 'uncommon', 'rare', 'legendary']; return o.indexOf(a.c.rarity) - o.indexOf(b.c.rarity); }
    return (a.c.cost ?? 99) - (b.c.cost ?? 99) || a.c.name.localeCompare(b.c.name);
  };
}

function filterBar(onChange) {
  const q = h('input', { placeholder: 'Search…', value: colFilter.q, oninput: (e) => { colFilter.q = e.target.value; onChange(); } });
  const rar = h('select', { onchange: (e) => { colFilter.rarity = e.target.value; onChange(); } },
    h('option', { value: '' }, 'All rarities'), ...['common', 'uncommon', 'rare', 'legendary'].map((r) => h('option', { value: r, selected: colFilter.rarity === r }, r)));
  const typ = h('select', { onchange: (e) => { colFilter.type = e.target.value; onChange(); } },
    h('option', { value: '' }, 'All types'), ...['creature', 'spell', 'equipment', 'tower', 'persistent', 'land'].map((t) => h('option', { value: t, selected: colFilter.type === t }, t)));
  const sort = h('select', { onchange: (e) => { colFilter.sort = e.target.value; onChange(); } },
    ...[['cost', 'Cost'], ['name', 'Name'], ['rarity', 'Rarity']].map(([v, l]) => h('option', { value: v, selected: colFilter.sort === v }, 'Sort: ' + l)));
  const fav = h('label', { class: 'muted' }, h('input', { type: 'checkbox', checked: colFilter.favOnly, onchange: (e) => { colFilter.favOnly = e.target.checked; onChange(); } }), ' ★ favorites');
  return h('div', { class: 'filters' }, q, rar, typ, sort, fav);
}

export function cardDetailModal(c) {
  openModal(c.name, (body) => {
    const you = store.you;
    const isFav = (you.favorites || []).includes(c.id);
    body.append(
      h('div', { class: 'meta', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '4px 0 10px' } },
        h('span', { class: `pill cls-${c.class}` }, c.class || 'Neutral'),
        c.archetype ? h('span', { class: 'pill' }, c.archetype) : null,
        h('span', { class: 'pill', style: { color: `var(--${c.rarity})` } }, c.rarity),
        c.cost != null ? h('span', { class: 'pill' }, c.cost + ' mana') : null,
        (c.attack != null) ? h('span', { class: 'pill' }, c.attack + '/' + c.health) : null,
        h('span', { class: 'pill' }, c.type), c.set ? h('span', { class: 'pill' }, c.set) : null,
      ),
      h('p', {}, c.text || '—'),
      (c.keywords && c.keywords.length) ? h('div', { class: 'muted' }, 'Keywords: ' + c.keywords.join(', ')) : null,
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { onclick: () => { action({ type: 'setFavorite', cardId: c.id, fav: !isFav }); } }, isFav ? '★ Unfavorite' : '☆ Favorite'),
        h('button', { onclick: () => openArtPicker(c.id) }, '🎨 Set Art'),
        !store.isDM ? h('button', { onclick: () => giftModal(c) }, '🎁 Gift this card') : null,
      ),
    );
  });
}

function giftModal(c) {
  openModal('Gift ' + c.name, (body, close) => {
    const others = store.lobby.players.filter((p) => p.id !== store.playerId && !p.isDM);
    if (!others.length) { body.append(h('div', { class: 'muted' }, 'No other players to gift to.')); return; }
    body.append(h('div', { class: 'col' }, ...others.map((p) =>
      h('button', { onclick: async () => { notify(await action({ type: 'sendGift', toId: p.id, cardId: c.id }), 'Gift sent to ' + p.name); close(); } }, 'Send to ' + p.name))));
  });
}

// ---------- DECK BUILDER ----------
let editingDeck = null; // {id,name,cards:[{cardId,count}]}
export function decksView() {
  const you = store.you;
  if (!editingDeck) {
    const first = you.decks[you.activeDeckId] || Object.values(you.decks)[0];
    editingDeck = first ? JSON.parse(JSON.stringify(first)) : { id: 'deck' + Date.now(), name: 'New Deck', cards: [] };
  }
  const isDM = store.isDM;
  const coll = you.collection || {};

  // pool: owned cards (or full DB for DM), respecting class
  let pool = isDM ? store.cardList.slice() : Object.keys(coll).map((id) => card(id)).filter(Boolean);
  if (!isDM && you.class) pool = pool.filter((c) => c.type === 'land' || !c.class || c.class === you.class);
  pool = pool.filter((c) => {
    if (colFilter.q && !c.name.toLowerCase().includes(colFilter.q.toLowerCase())) return false;
    if (colFilter.rarity && c.rarity !== colFilter.rarity) return false;
    if (colFilter.type && c.type !== colFilter.type) return false;
    return true;
  });
  pool.sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || a.name.localeCompare(b.name));

  const countIn = (id) => { const e = editingDeck.cards.find((x) => x.cardId === id); return e ? e.count : 0; };
  const owned = (id) => isDM ? 99 : (coll[id] || 0);
  const addCard = (id) => {
    const e = editingDeck.cards.find((x) => x.cardId === id);
    const total = editingDeck.cards.reduce((s, x) => s + x.count, 0);
    if (total >= 60) return toast('Deck is at 60 cards (max).', 'err');
    if (e) { if (e.count >= owned(id)) return toast('You only own ' + owned(id), 'err'); e.count++; }
    else editingDeck.cards.push({ cardId: id, count: 1 });
    render();
  };
  const removeCard = (id) => { const e = editingDeck.cards.find((x) => x.cardId === id); if (e) { e.count--; if (e.count <= 0) editingDeck.cards = editingDeck.cards.filter((x) => x.cardId !== id); } render(); };

  const poolGrid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))' } },
    ...pool.map((c) => cardTile(c, { count: isDM ? null : owned(c.id), onClick: () => addCard(c.id) })));

  const total = editingDeck.cards.reduce((s, e) => s + e.count, 0);
  const lands = editingDeck.cards.filter((e) => card(e.cardId)?.type === 'land').reduce((s, e) => s + e.count, 0);
  const sorted = editingDeck.cards.map((e) => ({ e, c: card(e.cardId) })).filter((x) => x.c).sort((a, b) => (a.c.cost ?? 99) - (b.c.cost ?? 99) || a.c.name.localeCompare(b.c.name));

  const deckList = h('div', { class: 'decklist' },
    h('input', { value: editingDeck.name, oninput: (e) => editingDeck.name = e.target.value, style: { marginBottom: '8px' } }),
    h('div', { class: 'row', style: { marginBottom: '6px' } },
      h('span', { class: 'pill', style: { color: total >= 30 && total <= 60 ? 'var(--good)' : 'var(--bad)' } }, total + ' / 30–60'),
      h('span', { class: 'pill' }, lands + ' lands'),
    ),
    manaCurve(editingDeck),
    h('div', { class: 'scroll grow', style: { marginTop: '14px' } }, ...sorted.map(({ e, c }) =>
      h('div', { class: 'deck-entry' },
        h('span', { class: 'cost', style: { width: '18px', height: '18px', fontSize: '11px' } }, c.cost ?? '–'),
        h('span', { class: 'grow', onmouseenter: null }, c.name),
        h('span', { class: 'pill' }, '×' + e.count),
        h('button', { class: 'sm ghost', onclick: () => removeCard(c.id) }, '−'),
        h('button', { class: 'sm ghost', onclick: () => addCard(c.id) }, '+'),
      ))),
    h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'primary grow', onclick: saveDeck }, '💾 Save'),
      h('button', { class: 'sm', onclick: () => { editingDeck = null; render(); } }, 'Reset'),
    ),
    h('div', { class: 'row wrap', style: { marginTop: '6px' } },
      h('select', { onchange: (e) => { if (e.target.value) { editingDeck = JSON.parse(JSON.stringify(you.decks[e.target.value])); render(); } } },
        h('option', { value: '' }, 'Load deck…'), ...Object.values(you.decks).map((d) => h('option', { value: d.id }, d.name))),
      h('button', { class: 'sm', onclick: () => { action({ type: 'setActiveDeck', deckId: editingDeck.id }); toast('Active deck set'); } }, 'Set Active'),
      h('button', { class: 'sm', onclick: exportDeck }, 'Export'),
      h('button', { class: 'sm', onclick: importDeck }, 'Import'),
      !isDM ? h('button', { class: 'sm', onclick: autoFillLands }, 'Auto-fill Lands') : null,
    ),
  );

  return h('div', { class: 'content' },
    filterBar(() => render()),
    h('div', { class: 'db-cols' }, h('div', { class: 'scroll' }, poolGrid), deckList),
  );
}

function manaCurve(deck) {
  const buckets = [0, 0, 0, 0, 0, 0, 0, 0]; // 0..7+
  for (const e of deck.cards) { const c = card(e.cardId); if (!c || c.type === 'land') continue; const cost = Math.min(7, c.cost ?? 0); buckets[cost] += e.count; }
  const max = Math.max(1, ...buckets);
  return h('div', {},
    h('div', { class: 'zone-label' }, 'Mana Curve'),
    h('div', { class: 'curve' }, ...buckets.map((v, i) => h('div', { class: 'bar', style: { height: (v / max * 100) + '%' }, title: v + ' cards' }, h('span', {}, i === 7 ? '7+' : i)))),
    h('div', { style: { height: '16px' } }),
  );
}
async function saveDeck() {
  const r = await action({ type: 'saveDeck', deck: editingDeck });
  if (r.error) return toast(r.error, 'err');
  editingDeck.id = r.deckId || editingDeck.id;
  toast('Deck saved' + (r.warnings && r.warnings.length ? ' (warnings)' : ''), 'ok');
}
function autoFillLands() {
  const total = editingDeck.cards.reduce((s, e) => s + e.count, 0);
  const e = editingDeck.cards.find((x) => x.cardId === 'basic-land');
  const need = Math.max(0, Math.min(5, 30 - total));
  if (e) e.count += need; else if (need) editingDeck.cards.push({ cardId: 'basic-land', count: need });
  render();
}
function exportDeck() {
  const blob = JSON.stringify({ kind: 'deck', deck: editingDeck }, null, 2);
  downloadFile(editingDeck.name.replace(/\s+/g, '_') + '.json', blob);
}
function importDeck() {
  uploadFile((data) => {
    try { const o = JSON.parse(data); if (o.deck) { editingDeck = o.deck; render(); toast('Deck imported'); } } catch { toast('Bad file', 'err'); }
  });
}

// ---------- import/export helpers ----------
export function downloadFile(name, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
export function uploadFile(cb) {
  const input = h('input', { type: 'file', accept: '.json' });
  input.addEventListener('change', () => { const f = input.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => cb(r.result); r.readAsText(f); });
  input.click();
}
async function exportCampaign() { const r = await action({ type: 'exportCampaign' }); if (r.data) downloadFile('campaign_' + store.code + '.json', JSON.stringify(r.data, null, 2)); }
function importCampaign() { uploadFile(async (data) => { try { notify(await action({ type: 'importCampaign', data: JSON.parse(data) }), 'Campaign imported'); } catch { toast('Bad file', 'err'); } }); }

function openDmDeckModal() { renderDmDeck(); }
