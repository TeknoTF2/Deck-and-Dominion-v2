/* Deck & Dominion client */
/* global io */
'use strict';

let socket = null;
let S = null;          // latest server state view
let DB = null;         // card database {cards, starters, classes}
let ME = { pid: null, code: null };
let activeTab = 'board';
let activeSide = 'log';
let targeting = null;  // {steps, si, payload, cardId, done}
let armedAttacker = null;
let lastLogLen = 0, chatSeen = 0;
let deckDraft = { name: 'New Deck', cards: [] };
let dmDeckDraft = { name: 'Encounter Deck', cards: [] };
let collFilters = { q: '', cls: '', rarity: '', sort: 'cost', fav: false };
let prevUnits = {};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const KW_HELP = {
  haste: 'Haste — can attack immediately and attack twice this turn',
  trample: 'Trample — excess damage hits player HP',
  deathtouch: 'Deathtouch — kills any creature it damages',
  lifelink: 'Lifelink — damage dealt restores your side\'s HP',
  firststrike: 'First Strike — deals damage first; if it kills, takes none back',
  taunt: 'Taunt — must be targeted before other creatures',
  poison: 'Poison X — poisoned creature takes X damage at end of its owner\'s turn for 3 rounds',
  shield: 'Shield X — absorbs X damage before health',
  retaliate: 'Retaliate X — deals X damage to attackers',
  fragile: 'Illusion — destroyed by any damage',
  nospell: 'Cannot be targeted by spells',
  noattack: 'Cannot be targeted by attacks',
  immune: 'Takes no damage',
  indestructible: 'Cannot be destroyed',
  kwlock: 'Keywords cannot be removed',
  voidtouch: 'Creatures it kills are exiled',
};
const CLASS_ICON = { commander: '🛡️', dps: '🐲', wizard: '🧙', sorcerer: '💀', crafter: '🌿', neutral: '🃏' };
const TYPE_ICON = { land: '⛰️', equip: '🗡️', tower: '🏰', persistent: '🔮', reaction: '⚡', spell: '✨' };
const PCOLORS = ['var(--p0)', 'var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)', 'var(--p5)'];

// ---------- boot ----------
async function boot() {
  DB = await (await fetch('/api/cards')).json();
  socket = io();
  wireSocket();
  wireHome();
  wireChrome();
  const saved = JSON.parse(localStorage.getItem('dnd_session') || 'null');
  if (saved && saved.code) {
    $('#join-name').value = saved.name || '';
    $('#join-code').value = saved.code || '';
  }
}

function wireHome() {
  $('#btn-host').onclick = () => {
    const name = $('#host-name').value.trim() || 'DM';
    socket.emit('createSession', { name });
    localStorage.setItem('dnd_name', name);
  };
  $('#btn-join').onclick = () => {
    const name = $('#join-name').value.trim();
    const code = $('#join-code').value.trim().toUpperCase();
    if (!name || !code) return toast('Enter your name and the session code');
    const saved = JSON.parse(localStorage.getItem('dnd_session') || 'null');
    const token = saved && saved.code === code ? saved.pid : null;
    socket.emit('join', { code, name, token, spectator: $('#join-spec').checked });
    localStorage.setItem('dnd_name', name);
  };
}

function wireSocket() {
  socket.on('joined', ({ code, pid, isDM }) => {
    ME = { pid, code, isDM };
    localStorage.setItem('dnd_session', JSON.stringify({ code, pid: isDM ? 'dm' : pid, name: localStorage.getItem('dnd_name') }));
    $('#screen-home').classList.add('hidden');
    $('#screen-main').classList.remove('hidden');
    $('#hdr-code').textContent = code;
    if (isDM) $('#tab-dm').classList.remove('hidden');
  });
  socket.on('state', (view) => { S = view; render(); });
  socket.on('err', ({ msg }) => toast(msg));
  socket.on('peek', (pk) => peekModal(pk));
  socket.on('packOpened', ({ cards, tier }) => packModal(cards, tier));
  socket.on('kicked', () => { alert('You were removed from the session by the DM.'); location.reload(); });
  socket.on('connect', () => {
    // auto-rejoin
    const saved = JSON.parse(localStorage.getItem('dnd_session') || 'null');
    if (ME.code) socket.emit('join', { code: ME.code, name: localStorage.getItem('dnd_name'), token: ME.isDM ? 'dm' : ME.pid });
    else if (saved && saved.code && saved.name) { /* wait for user */ }
  });
}

function wireChrome() {
  $$('#tabs .tab').forEach(b => b.onclick = () => { activeTab = b.dataset.tab; $$('#tabs .tab').forEach(x => x.classList.toggle('active', x === b)); render(); });
  $$('.side-tabs .stab').forEach(b => b.onclick = () => { activeSide = b.dataset.side; $$('.side-tabs .stab').forEach(x => x.classList.toggle('active', x === b)); if (activeSide === 'chat') { chatSeen = (S && S.chat.length) || 0; $('#chat-dot').classList.add('hidden'); } render(); });
  $('#chat-send').onclick = sendChat;
  $('#chat-msg').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  $('#log-search').addEventListener('input', renderLog);
  $('#log-export').onclick = () => {
    const txt = (S ? S.log : []).map(l => new Date(l.t).toLocaleTimeString() + '  ' + l.msg).join('\n');
    download('combat-log.txt', txt);
  };
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-hover]');
    if (t) showHover(t.dataset.hover, e); else hideHover();
  });
  document.addEventListener('mousemove', (e) => positionHover(e));
}

function sendChat() {
  const msg = $('#chat-msg').value.trim();
  if (!msg) return;
  const to = $('#chat-to').value || null;
  socket.emit('chat', { msg, to });
  $('#chat-msg').value = '';
}

// ---------- helpers ----------
function card(id) { return DB.cards[id]; }
function toast(msg, ok = false) {
  const t = el(`<div class="toast ${ok ? 'ok' : ''}">${esc(msg)}</div>`);
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name; a.click();
}
function uploadJSON(cb) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => { const f = inp.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { cb(JSON.parse(r.result)); } catch (e) { toast('Invalid JSON file'); } }; r.readAsText(f); };
  inp.click();
}
function mySide() { return S.isDM ? 'dm' : 'party'; }
function myMana() { return S.isDM ? (S.dm.mana || 0) : (S.shared.manaPersist + S.shared.manaBurst); }
function playerColor(pid) {
  const idx = S.players.findIndex(p => p.id === pid);
  return pid === 'dm' ? 'var(--dmcol)' : PCOLORS[Math.max(0, idx) % PCOLORS.length];
}
function artFor(c, u) {
  const o = S && S.art && S.art[c.id];
  if (o) return `background-image:url('${o}')`;
  return '';
}
function artEmoji(c) {
  if (c.type === 'creature') return CLASS_ICON[c.cls] || '🃏';
  return TYPE_ICON[c.type] || '✨';
}
function kwChips(kws) {
  return kws.map(k => { const n = k.split(':')[0]; return `<span title="${esc(KW_HELP[n] || n)}">${esc(k)}</span>`; }).join(' ');
}

// ---------- hover preview ----------
function showHover(cid, e) {
  const c = card(cid); if (!c) return hideHover();
  const hc = $('#hovercard');
  hc.innerHTML = `
    <div class="hc-name"><span>${esc(c.name)}</span><span class="hc-cost">${c.type === 'land' ? '' : (c.cost || 0) + '💧'}</span></div>
    <div class="hc-art" style="${artFor(c)}">${S && S.art && S.art[c.id] ? '' : artEmoji(c)}</div>
    <div class="hc-meta">${esc(c.cls)} · ${esc(c.arch || 'staple')} · ${esc(c.set)} · <b>${esc(c.rarity)}</b> · ${esc(c.type)}${c.tribe ? ' · ' + esc(c.tribe) : ''}</div>
    <div class="hc-text">${esc(c.text)}</div>
    ${c.kw && c.kw.length ? `<div class="hc-kw">${c.kw.map(k => { const n = k.split(':')[0]; return esc(KW_HELP[n] || k); }).join('<br>')}</div>` : ''}
    ${c.atk != null ? `<div class="hc-stats"><span style="color:var(--accent)">${c.atk}</span> / <span style="color:var(--good)">${c.hp}</span></div>` : ''}
    ${c.manual ? '<div class="hc-kw">⚠ Resolved manually at the table</div>' : ''}`;
  hc.classList.remove('hidden');
  positionHover(e);
}
function hideHover() { $('#hovercard').classList.add('hidden'); }
function positionHover(e) {
  const hc = $('#hovercard');
  if (hc.classList.contains('hidden')) return;
  const x = Math.min(e.clientX + 18, innerWidth - 260);
  const y = Math.min(e.clientY + 12, innerHeight - hc.offsetHeight - 12);
  hc.style.left = x + 'px'; hc.style.top = Math.max(8, y) + 'px';
}

// ---------- modal ----------
function modal(html, opts = {}) {
  closeModal();
  const ov = el(`<div class="overlay"><div class="modal">${html}</div></div>`);
  ov.addEventListener('mousedown', e => { if (e.target === ov && !opts.sticky) closeModal(); });
  $('#modal-root').appendChild(ov);
  return ov.querySelector('.modal');
}
function closeModal() { $('#modal-root').innerHTML = ''; }
function confirmBox(msg, onYes) {
  const m = modal(`<h3>Confirm</h3><p>${esc(msg)}</p><div class="m-actions"><button id="cf-no">Cancel</button><button id="cf-yes" class="primary">Confirm</button></div>`);
  m.querySelector('#cf-yes').onclick = () => { closeModal(); onYes(); };
  m.querySelector('#cf-no').onclick = closeModal;
}

// ---------- render root ----------
function render() {
  if (!S) return;
  renderHeader();
  renderSidebar();
  $$('#tab-content .view').forEach(v => v.classList.add('hidden'));
  const v = $('#view-' + activeTab);
  if (v) v.classList.remove('hidden');
  if (activeTab === 'board') renderBoardTab();
  if (activeTab === 'collection') renderCollection();
  if (activeTab === 'decks') renderDecks();
  if (activeTab === 'dm' && S.isDM) renderDMPanel();
  renderPromptBar();
}

function renderHeader() {
  const st = $('#hdr-status');
  let turnTxt = '';
  if (S.state === 'playing') {
    const cur = S.turn.current === 'dm' ? 'DM' : (S.players.find(p => p.id === S.turn.current) || {}).name;
    turnTxt = S.turn.pickingNext ? '⏳ choosing next player' : cur ? `🎲 ${esc(cur)}'s turn — ${S.turn.phase}` : '';
  }
  st.innerHTML = `${S.paused ? '<span style="color:var(--bad)">⏸ PAUSED</span>' : ''}
    <span>${S.state === 'lobby' ? '🏛 Lobby' : S.state === 'ended' ? '🏁 Ended' : turnTxt}</span>
    <span title="Shared mana pool" style="color:var(--mana)">💧${S.shared.manaPersist + S.shared.manaBurst}${S.shared.manaBurst ? ` (${S.shared.manaBurst} burst)` : ''}</span>
    <span title="Party HP" style="color:var(--hp)">❤️${S.shared.hp}/${S.shared.maxHp}</span>
    ${S.shared.shield ? `<span style="color:var(--shield)">🛡${S.shared.shield}</span>` : ''}`;
}

// ---------- sidebar ----------
function renderSidebar() {
  $$('.side-view').forEach(x => x.classList.add('hidden'));
  $('#side-' + activeSide).classList.remove('hidden');
  renderLog();
  renderChat();
  if (activeSide === 'piles') renderPiles();
  if (activeSide === 'party') renderParty();
}
function renderLog() {
  const q = ($('#log-search').value || '').toLowerCase();
  const list = $('#log-list');
  const items = S.log.filter(l => !q || l.msg.toLowerCase().includes(q));
  list.innerHTML = items.map(l => `<div class="log-line ${l.type}">${esc(l.msg)}</div>`).join('');
  if (S.log.length !== lastLogLen) { list.scrollTop = list.scrollHeight; lastLogLen = S.log.length; }
}
function renderChat() {
  const list = $('#chat-list');
  list.innerHTML = S.chat.map(m => `<div class="chat-line ${m.to ? 'whisper' : ''}"><b>${esc(m.fromName)}${m.to ? ' → ' + esc(nameOf(m.to)) : ''}:</b> ${esc(m.msg)}</div>`).join('');
  list.scrollTop = list.scrollHeight;
  const sel = $('#chat-to');
  const opts = ['<option value="">Everyone</option>'];
  if (!S.isDM) opts.push('<option value="dm">DM (whisper)</option>');
  for (const p of S.players) if (p.id !== ME.pid) opts.push(`<option value="${p.id}">${esc(p.name)} (whisper)</option>`);
  if (sel.innerHTML.length !== opts.join('').length) sel.innerHTML = opts.join('');
  if (S.chat.length > chatSeen && activeSide !== 'chat') $('#chat-dot').classList.remove('hidden');
}
function nameOf(pid) { return pid === 'dm' ? 'DM' : ((S.players.find(p => p.id === pid) || {}).name || '?'); }

function renderPiles() {
  const pv = $('#side-piles');
  const pile = (title, arr, zone, who) => `
    <div class="pile-view"><h4>${title} (${arr.length})</h4><div class="pile-cards">
      ${arr.map((e, i) => `<span class="pile-chip" data-hover="${esc(e.cardId)}" data-pilezone="${zone}" data-pilewho="${who}" data-pileidx="${i}">${esc(e.name || (card(e.cardId) || {}).name || e.cardId)}</span>`).join('') || '<span class="mini">empty</span>'}
    </div></div>`;
  pv.innerHTML =
    pile('Party graveyard', S.grave, 'grave', 'party') +
    pile('Party exile', S.exile, 'exile', 'party') +
    pile('DM graveyard', S.dmGrave, 'grave', 'dm') +
    pile('DM exile', S.dmExile, 'exile', 'dm');
  if (S.isDM) {
    pv.querySelectorAll('.pile-chip').forEach(ch => ch.onclick = () => dmPileMenu(ch.dataset.pilezone, ch.dataset.pilewho, +ch.dataset.pileidx));
  }
}

function renderParty() {
  const pv = $('#side-party');
  pv.innerHTML = S.players.map(p => `
    <div class="lp-card" style="border-left:4px solid ${playerColor(p.id)};margin-bottom:8px">
      <b>${esc(p.name)}</b> ${p.connected ? '🟢' : '🔴'} ${S.turn.current === p.id ? '<span class="badge-turn">turn</span>' : ''}
      <div class="mini">${esc(p.cls || 'no class')} / ${esc(p.arch || '-')}</div>
      <div class="mini">Hand ${p.handCount} · Deck ${p.deckCount} · Lands ${p.lands.length}</div>
      ${p.id !== ME.pid && !S.spectator && !S.isDM ? `<button class="mini" data-gift="${p.id}">🎁 Gift cards</button>` : ''}
    </div>`).join('') + `
    <div class="lp-card" style="border-left:4px solid var(--dmcol)">
      <b>DM</b> ${S.turn.current === 'dm' ? '<span class="badge-turn">turn</span>' : ''}
      <div class="mini">HP ${S.dm.hp}/${S.dm.maxHp} · Hand ${S.dm.handCount} · Deck ${S.dm.deckCount} · Mana ${S.dm.mana}</div>
    </div>
    <div class="pile-view"><h4>Gift & trade history</h4>${S.giftHistory.slice(-10).reverse().map(g => `<div class="mini">${esc(g.fromName)} → ${esc(g.toName)}: ${Object.entries(g.cards).map(([id, n]) => n + 'x ' + esc((card(id) || {}).name)).join(', ')} (${g.status})</div>`).join('') || '<span class="mini">none yet</span>'}</div>`;
  pv.querySelectorAll('[data-gift]').forEach(b => b.onclick = () => giftModal(b.dataset.gift));
  // pending gifts to me
  for (const gf of S.gifts.filter(x => x.to === ME.pid && x.status === 'pending')) {
    if (!document.getElementById('gift-' + gf.id)) {
      const m = modal(`<h3 id="gift-${gf.id}">🎁 Gift from ${esc(gf.fromName)}</h3>
        <p>${Object.entries(gf.cards).map(([id, n]) => n + 'x ' + esc((card(id) || {}).name)).join(', ')}</p>
        <div class="m-actions"><button id="g-rej">Reject</button><button id="g-acc" class="primary">Accept</button></div>`, { sticky: true });
      m.querySelector('#g-acc').onclick = () => { socket.emit('respondGift', { id: gf.id, accept: true }); closeModal(); };
      m.querySelector('#g-rej').onclick = () => { socket.emit('respondGift', { id: gf.id, accept: false }); closeModal(); };
    }
  }
}

// ---------- BOARD TAB ----------
function renderBoardTab() {
  const v = $('#view-board');
  if (S.state === 'lobby') return renderLobby(v);
  if (S.state === 'ended') {
    v.innerHTML = `<div class="lobby"><div class="panel" style="text-align:center">
      <h2>🏁 Encounter over — ${S.winner === 'party' ? 'The party wins!' : S.winner === 'dm' ? 'The DM wins!' : 'Winner: ' + esc(S.winner || 'declared by DM')}</h2>
      ${S.isDM ? '<button id="btn-back-lobby" class="primary">Back to lobby / new encounter</button>' : '<p class="mini">Waiting for the DM…</p>'}
    </div></div>`;
    const b = v.querySelector('#btn-back-lobby');
    if (b) b.onclick = () => socket.emit('dmAction', { op: 'toLobby' });
    return;
  }
  renderGame(v);
}

function renderLobby(v) {
  const me = S.players.find(p => p.id === ME.pid);
  const cls = DB.classes;
  v.innerHTML = `<div class="lobby">
    <div class="panel">
      <h2>Session ${esc(S.code)} — invite players with this code</h2>
      <p class="mini">Share the code (or this URL) with your party. ${S.isDM ? 'You are the DM.' : ''}</p>
      <div class="lobby-players">
        ${S.players.map(p => `<div class="lp-card ${p.ready ? 'ready' : ''}" style="border-left:4px solid ${playerColor(p.id)}">
          <b>${esc(p.name)}</b> ${p.connected ? '🟢' : '🔴'} ${p.ready ? '✅' : ''}
          <div class="mini">${esc(p.cls || 'choosing…')} ${p.arch ? '/ ' + esc(p.arch) : ''}</div>
          ${S.isDM ? `<button class="mini danger" data-kick="${p.id}">Kick</button>` : ''}
        </div>`).join('') || '<p class="mini">No players yet</p>'}
      </div>
    </div>
    ${!S.isDM && !S.spectator && me ? `
    <div class="panel">
      <h2>${me.cls ? 'Your class: ' + esc(me.cls) + ' / ' + esc(me.arch) : 'Choose your class & archetype'}</h2>
      <div class="class-pick">
        ${Object.entries(cls).map(([k, c]) => `
          <div class="class-card ${me.cls === k ? 'sel' : ''}" data-cls="${k}">
            <h4>${CLASS_ICON[k]} ${k[0].toUpperCase() + k.slice(1)} <span class="mini">(${c.color})</span></h4>
            <div class="cc-role">${esc(c.role)} — ${esc(c.owns)}</div>
            <div class="arch-list">${Object.entries(c.archetypes).map(([a, d]) => `<button class="arch-btn ${me.cls === k && me.arch === a ? 'sel' : ''}" data-cls="${k}" data-arch="${a}" title="${esc(d)}">${a[0].toUpperCase() + a.slice(1)} <span class="mini">${esc(d)}</span></button>`).join('')}</div>
          </div>`).join('')}
      </div>
      <p class="mini">Picking a class grants its 30-card starter deck & collection automatically.</p>
      <div class="dm-row">
        <label>Battle deck:</label>
        <select id="lobby-deck">${(S.decks || []).map(d => `<option ${S.activeDeck === d.name ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
        <button id="lobby-ready" class="${me.ready ? '' : 'primary'}">${me.ready ? 'Unready' : 'Ready up!'}</button>
      </div>
    </div>` : ''}
    ${S.isDM ? `
    <div class="panel">
      <h2>DM: start the encounter</h2>
      <div class="dm-row">
        <label>Party HP</label><input type="number" id="enc-php" value="${(S.players.filter(p => !p.isDM).length || 1) * 8}">
        <label>DM HP</label><input type="number" id="enc-dhp" value="${(S.players.filter(p => !p.isDM).length || 1) * 10}">
        <label>Encounter deck</label>
        <select id="enc-deck">${(S.dm.deckNames || []).map(d => `<option ${S.dm.activeDeck === d ? 'selected' : ''}>${esc(d)}</option>`).join('') || '<option value="">— build one in DM Panel → Decks —</option>'}</select>
        <button id="btn-start" class="primary">⚔ Start encounter</button>
      </div>
      <p class="mini">Difficulty guide (DM HP per player): Tutorial 6 · Easy 8 · Medium 10 · Hard 12 · Boss 15+</p>
    </div>` : ''}
  </div>`;
  v.querySelectorAll('.arch-btn').forEach(b => b.onclick = (e) => { e.stopPropagation(); socket.emit('selectClass', { cls: b.dataset.cls, arch: b.dataset.arch }); });
  const rb = v.querySelector('#lobby-ready');
  if (rb) rb.onclick = () => socket.emit('ready', { ready: !me.ready });
  const ld = v.querySelector('#lobby-deck');
  if (ld) ld.onchange = () => socket.emit('setActiveDeck', { name: ld.value });
  const sb = v.querySelector('#btn-start');
  if (sb) sb.onclick = () => {
    if (S.dm.deckNames && S.dm.deckNames.length) socket.emit('setDMDeck', { name: v.querySelector('#enc-deck').value });
    socket.emit('dmAction', { op: 'startEncounter', partyHp: +v.querySelector('#enc-php').value, dmHp: +v.querySelector('#enc-dhp').value });
  };
  v.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => confirmBox('Kick this player?', () => socket.emit('dmAction', { op: 'kick', pid: b.dataset.kick })));
}

// ---------- game board ----------
function renderGame(v) {
  const isDM = S.isDM;
  const meActor = isDM ? S.dm : (S.players.find(p => p.id === ME.pid) || { lands: [] });
  const dmUnits = S.board.filter(u => u.side === 'dm');
  const myTurn = S.turn.current === ME.pid || (isDM && S.turn.current === 'dm');
  const phase = S.turn.phase;

  v.innerHTML = `<div class="board-wrap">
    <section class="zone dm-zone">
      <div class="zone-head">
        <span class="hp-pill face-target" id="dm-face">👹 DM <span class="hp">${S.dm.hp}</span>/${S.dm.maxHp}</span>
        <span class="pill-sm">✋ ${S.dm.handCount}</span><span class="pill-sm">📚 ${S.dm.deckCount}</span>
        <span class="pill-sm" style="color:var(--mana)">💧 ${S.dm.mana || 0}</span>
        <div class="lands">${(S.dm.lands || []).map(l => `<div class="land ${l.tapped ? 'tapped' : ''}" ${isDM ? `data-dmland="${l.id}"` : ''} title="DM land">⛰️</div>`).join('')}</div>
      </div>
      <div class="board-row" id="dm-row">
        ${dmUnits.map(u => unitHtml(u)).join('') || '<span class="mini" style="align-self:center">No DM forces on the board</span>'}
      </div>
    </section>
    <section class="zone party-zone">
      <span class="hp-pill face-target" id="party-face">🧑‍🤝‍🧑 Party <span class="hp">${S.shared.hp}</span>/${S.shared.maxHp}${S.shared.shield ? ` <span class="sh">🛡${S.shared.shield}</span>` : ''} <span class="mn">💧${S.shared.manaPersist + S.shared.manaBurst}</span></span>
      <div id="party-row">${partyGroupsHtml()}</div>
    </section>
    <section class="zone my-zone">
      <div class="my-head">
        <div class="phase-track">${['draw', 'mana', 'play', 'attack', 'resolution'].map(p => `<span class="phase ${phase === p && S.turn.current ? 'now' : ''}">${p}</span>`).join('')}</div>
        <div class="lands" id="my-lands">${meActor.lands.map(l => `<div class="land ${l.tapped ? 'tapped' : ''}" data-land="${l.id}" title="Tap for 1 mana">⛰️</div>`).join('')}</div>
        <div class="turn-controls" id="turn-controls"></div>
      </div>
      <div class="hand" id="my-hand">${(S.hand || []).map(h => handCardHtml(h)).join('') || '<span class="mini" style="align-self:center">' + (S.spectator ? 'Spectating' : 'Empty hand') + '</span>'}</div>
    </section>
  </div>`;

  renderTurnControls(v.querySelector('#turn-controls'));
  wireBoardEvents(v);
  markTargetables();
  trackAnimations();
}

function partyGroupsHtml() {
  const groups = {};
  for (const u of S.board.filter(x => x.side === 'party')) {
    (groups[u.owner] = groups[u.owner] || []).push(u);
  }
  const order = Object.keys(groups).sort((a, b) => (a === ME.pid ? -1 : b === ME.pid ? 1 : 0));
  // always show my group even if empty (for orientation)
  if (!S.isDM && !S.spectator && !groups[ME.pid]) order.unshift(ME.pid), groups[ME.pid] = [];
  return order.map(pid => `
    <div class="owner-group ${pid === ME.pid ? 'mine' : ''}">
      <div class="owner-label" style="color:${playerColor(pid)}"><span class="swatch" style="background:${playerColor(pid)}"></span>${esc(nameOf(pid))}${pid === ME.pid ? ' (you)' : ''}</div>
      <div class="owner-units">${groups[pid].map(u => unitHtml(u)).join('') || '<span class="mini">no creatures</span>'}</div>
    </div>`).join('') || '<div class="mini" style="padding:20px">No party creatures yet — play some cards!</div>';
}

function unitHtml(u) {
  const c = card(u.cardId) || { name: u.name };
  const st = clientStats(u);
  const kws = allKws(u);
  const hurt = u.dmg > 0;
  const badges = [];
  if (u.poison.length) badges.push('☠️');
  if (u.cantAttack > 0) badges.push('🧊');
  if (u.suppressed) badges.push('🔇');
  if (u.tempTurns > 0) badges.push('⏳');
  if (u.token) badges.push('👥');
  const canAtk = isMyUnit(u) && myTurnNow() && (S.turn.phase === 'attack') && clientCanAttack(u);
  return `<div class="unit ${u.side === 'dm' ? 'dmside' : ''} ${u.type} ${canAtk ? 'can-attack' : ''} ${armedAttacker === u.uid ? 'selected' : ''}"
      data-unit="${u.uid}" data-hover="${esc(u.cardId === 'token' ? '' : u.cardId)}" style="border-color:${u.side === 'dm' ? '' : playerColor(u.owner)}">
    ${u.shield ? `<span class="u-shield">${u.shield}</span>` : ''}
    <span class="u-badges">${badges.join('')}</span>
    <div class="u-name">${esc(u.name)}</div>
    <div class="u-art" style="${artFor(c)}">${S.art && S.art[u.cardId] ? '' : artEmoji(Object.assign({ type: u.type, cls: (c.cls || 'neutral') }, c))}</div>
    <div class="u-kw">${esc(kws.map(k => k.split(':')[0]).join(' '))}</div>
    <div class="u-stats"><span class="u-atk">${st.atk}</span><span class="u-hp ${hurt ? 'hurt' : ''}">${st.effHp}</span></div>
    ${u.equips.length ? `<span class="u-equip" title="${esc(u.equips.map(e => e.name).join(', '))}">🗡${u.equips.length > 1 ? u.equips.length : ''}</span>` : ''}
  </div>`;
}

function handCardHtml(h) {
  const c = card(h.cardId);
  if (!c) return '';
  const afford = (c.cost || 0) <= myMana() || c.type === 'land';
  const playableNow = canPlayNow(c);
  return cardHtml(c, { inst: h.inst, cls: (afford && playableNow ? '' : 'unplayable') + (c.type === 'reaction' ? ' reaction-glow' : '') });
}

function cardHtml(c, opts = {}) {
  return `<div class="card r-${c.rarity} ${opts.cls || ''}" ${opts.inst ? `data-inst="${opts.inst}"` : ''} data-cid="${c.id}" data-hover="${c.id}">
    ${c.type !== 'land' ? `<span class="c-cost">${c.cost || 0}</span>` : ''}
    ${opts.count ? `<span class="count-badge">x${opts.count}</span>` : ''}
    ${opts.fav != null ? `<span class="fav-star ${opts.fav ? 'on' : ''}" data-fav="${c.id}">⭐</span>` : ''}
    <div class="c-name">${esc(c.name)}</div>
    <div class="c-art" style="${artFor(c)}">${S.art && S.art[c.id] ? '' : artEmoji(c)}</div>
    <div class="c-text">${esc(c.text)}</div>
    ${c.atk != null ? `<div class="c-stats"><span style="color:var(--accent)">${c.atk}</span><span style="color:var(--good)">${c.hp}</span></div>` : `<span class="c-type">${esc(c.type)}</span>`}
  </div>`;
}

function isMyUnit(u) { return S.isDM ? u.side === 'dm' : u.owner === ME.pid; }
function myTurnNow() { return S.turn.current === (S.isDM ? 'dm' : ME.pid); }

function allKws(u) {
  const eq = u.equips.flatMap(e => e.kw || []);
  if (u.suppressed) return [];
  return [...new Set([...u.kwPerm, ...u.kwTemp.map(k => k.kw), ...eq])];
}
function clientHasKw(u, kw) { return allKws(u).some(k => k.split(':')[0] === kw); }
function clientStats(u) {
  // trust displayed board mostly server-side; approximate like server (auras & scaling included via same logic)
  let atk = u.baseAtk + u.permA, hp = u.baseHp + u.permH;
  for (const b of u.turnBuffs) { atk += b.a || 0; hp += b.h || 0; }
  for (const e of u.equips) { let ea = e.a || 0; if ((card(u.cardId) || {}).equipAtkDouble) ea *= 2; atk += ea; hp += e.h || 0; }
  const c = card(u.cardId) || {};
  if (!u.suppressed) {
    if (c.scaling) { atk += (c.scaling.a || 0) * countPerClient(c.scaling, u); hp += (c.scaling.h || 0) * countPerClient(c.scaling, u); }
  }
  for (const src of S.board) {
    if (src.side !== u.side || src.suppressed) continue;
    const sc = card(src.cardId) || {}; const a = sc.aura;
    if (!a) continue;
    if (a.other && src.uid === u.uid) continue;
    let m = false;
    if (a.scope === 'friendly') m = u.type === 'creature';
    else if ((a.scope || '').startsWith('tribe:')) m = u.tribe === a.scope.slice(6);
    else if ((a.scope || '').startsWith('kw:')) m = clientHasKw(u, a.scope.slice(3));
    else if (a.scope === 'towers') m = u.type === 'tower';
    if (m) { atk += a.a || 0; hp += a.h || 0; }
  }
  atk = Math.max(0, atk);
  return { atk, hp, effHp: hp - u.dmg };
}
function countPerClient(s, u) {
  const [key, dv] = String(s.per).split(':');
  const friendly = S.board.filter(x => x.side === u.side);
  if (key === 'tribe') return friendly.filter(x => x.tribe === dv && (!s.other || x.uid !== u.uid)).length;
  if (key === 'grave') return Math.floor(S.grave.length / (+dv || 1));
  if (key === 'graveCreatures') { const n = S.grave.filter(g => (card(g.cardId) || {}).type === 'creature' || g.wasCreature).length; return dv ? Math.floor(n / +dv) : n; }
  if (key === 'mana') return Math.floor((S.shared.manaPersist + S.shared.manaBurst) / (+dv || 1));
  if (key === 'cheaperFriendly') return friendly.filter(x => x.uid !== u.uid && ((card(x.cardId) || {}).cost || 0) < ((card(u.cardId) || {}).cost || 0)).length;
  return 0;
}
function clientCanAttack(u) {
  if (u.type !== 'creature' || u.cantAttack > 0) return false;
  if (clientStats(u).atk <= 0) return false;
  const hasHaste = clientHasKw(u, 'haste') || u.rezHaste;
  if (u.enteredRound === S.turn.round && !hasHaste) return false;
  return u.attacksUsed < (clientHasKw(u, 'haste') ? 2 : 1);
}
function canPlayNow(c) {
  if (S.spectator) return false;
  if (c.type === 'reaction' && S.pendingReaction && S.pendingReaction.mine) return true;
  if (!myTurnNow()) return false;
  if (c.type === 'land') return ['mana', 'play', 'draw'].includes(S.turn.phase);
  return S.turn.phase === 'play';
}

function renderTurnControls(box) {
  if (!box) return;
  const isDM = S.isDM;
  const me = S.players.find(p => p.id === ME.pid);
  const html = [];
  if (S.spectator) { box.innerHTML = '<span class="mini">👁 spectator</span>'; return; }
  if (S.turn.pickingNext === true) {
    if (isDM) html.push('<span class="mini">Players pick who goes…</span>');
    else if (!S.turn.acted.includes(ME.pid)) html.push('<button id="btn-taketurn" class="primary">🎲 Take my turn</button>');
    else html.push('<span class="mini">Waiting for a teammate…</span>');
  } else if (S.turn.pickingNext === 'byCurrent' && S.turn.current === ME.pid) {
    html.push('<span class="mini">Pass turn to:</span>');
    for (const p of S.players.filter(p => !S.turn.acted.includes(p.id) && p.id !== ME.pid)) html.push(`<button data-passto="${p.id}">${esc(p.name)}</button>`);
  } else if (myTurnNow()) {
    if (S.turn.awaitDrawOrKeep && !isDM) {
      html.push('<span class="mini">Max hand!</span><button id="btn-dok-draw" class="primary">Draw anyway</button><button id="btn-dok-keep">Keep hand</button>');
    } else {
      html.push('<button id="btn-nextphase">Next phase ▸</button>');
      html.push('<button id="btn-endturn" class="primary">End turn</button>');
    }
  }
  if (me && S.turn.round === 1 && !S.turn.acted.includes(ME.pid) && me.mulligans < 2 && !isDM && (S.hand || []).length) {
    html.push(`<button id="btn-mulligan" title="Shuffle your hand into your deck and redraw (${2 - me.mulligans} left)">↻ Mulligan</button>`);
  }
  box.innerHTML = html.join('');
  const q = (id) => box.querySelector(id);
  if (q('#btn-taketurn')) q('#btn-taketurn').onclick = () => socket.emit('takeTurn');
  if (q('#btn-nextphase')) q('#btn-nextphase').onclick = () => socket.emit('nextPhase');
  if (q('#btn-endturn')) q('#btn-endturn').onclick = () => socket.emit('endTurn');
  if (q('#btn-mulligan')) q('#btn-mulligan').onclick = () => socket.emit('mulligan');
  if (q('#btn-dok-draw')) q('#btn-dok-draw').onclick = () => socket.emit('drawOrKeep', { choice: 'draw' });
  if (q('#btn-dok-keep')) q('#btn-dok-keep').onclick = () => socket.emit('drawOrKeep', { choice: 'keep' });
  box.querySelectorAll('[data-passto]').forEach(b => b.onclick = () => socket.emit('passTo', { pid: b.dataset.passto }));
}

function wireBoardEvents(v) {
  // lands
  v.querySelectorAll('[data-land]').forEach(l => l.onclick = () => { if (myTurnNow()) socket.emit('tapLand', { landId: l.dataset.land }); else toast('Tap lands on your turn'); });
  v.querySelectorAll('[data-dmland]').forEach(l => l.onclick = () => { if (S.isDM) socket.emit('tapLand', { landId: l.dataset.dmland }); });
  // hand cards
  v.querySelectorAll('#my-hand .card').forEach(cd => cd.onclick = () => onHandCardClick(cd.dataset.inst, cd.dataset.cid));
  // units
  v.querySelectorAll('.unit').forEach(un => un.onclick = () => onUnitClick(un.dataset.unit));
  // faces
  const dmFace = v.querySelector('#dm-face'), partyFace = v.querySelector('#party-face');
  if (dmFace) dmFace.onclick = () => onFaceClick('dm');
  if (partyFace) partyFace.onclick = () => onFaceClick('party');
}

// ---------- play & target flow ----------
function onHandCardClick(inst, cid) {
  if (S.spectator) return;
  const c = card(cid);
  if (!c) return;
  // reaction window play
  if (S.pendingReaction && S.pendingReaction.mine && c.reaction && (c.reaction.on === S.pendingReaction.kind || c.reaction.on === 'any')) {
    return startPlay(c, inst, true);
  }
  if (!myTurnNow()) return toast('Not your turn' + (c.type === 'reaction' ? ' — reactions fire when prompted' : ''));
  if (c.type === 'land') { if ((c.cost || 0) === 0) return socket.emit('playCard', { inst }); }
  if (S.turn.phase !== 'play' && c.type !== 'land') return toast('Play cards during the Play phase (use Next phase)');
  if ((c.cost || 0) > myMana()) return toast(`Need ${c.cost} mana — tap lands or ramp (you have ${myMana()})`);
  startPlay(c, inst, false);
}

function startPlay(c, inst, asReaction) {
  const steps = buildSteps(c, asReaction);
  targeting = { card: c, steps, si: 0, payload: { inst }, asReaction };
  if (!steps.length) return finishPlay();
  runStep();
}

function buildSteps(c, asReaction) {
  const steps = [];
  const mySd = mySide();
  const enemySd = mySd === 'party' ? 'dm' : 'party';
  if (c.cost2) {
    const cc = c.cost2;
    if (cc.sac || cc.sacUpTo) steps.push({ kind: 'units', into: 'sacs', n: cc.sac || cc.sacUpTo, upTo: !!cc.sacUpTo, side: mySd, label: `Sacrifice ${cc.sac || 'up to ' + cc.sacUpTo} creature(s)`, filter: cc.sacFilter });
    if (cc.discard) steps.push({ kind: 'hand', into: 'discards', n: cc.discard, label: `Discard ${cc.discard} card(s)` });
    if (cc.exile) steps.push({ kind: 'grave', into: 'exiles', n: cc.exile, typeFilter: cc.exileType, label: `Exile ${cc.exile} card(s) from the graveyard${cc.exileType ? ' (' + cc.exileType + ')' : ''}` });
  }
  if (c.type === 'equip') steps.push({ kind: 'units', into: 'targets', n: 1, side: mySd, label: 'Choose a creature to equip' });
  for (const a of (c.play || [])) {
    if (a.choose) steps.push({ kind: 'choice', options: a.choose.map(o => o.label), label: 'Choose one' });
    if (a.kwPick) steps.push({ kind: 'kws', from: a.kwPick.from, n: a.kwPick.n, label: `Choose ${a.kwPick.n} keyword(s)` });
    if (a.t && ['creature', 'friendly', 'enemy', 'any'].includes(a.t)) {
      const side = a.t === 'friendly' ? mySd : a.t === 'enemy' ? enemySd : null;
      steps.push({ kind: 'units', into: 'targets', n: a.n || 1, upTo: !!a.upTo, side, allowFace: a.t === 'any', filter: a.filter, spellTargeting: c.type === 'spell' || c.type === 'reaction', label: labelFor(a, c) });
    }
    if (a.t === 'player') steps.push({ kind: 'player', label: 'Choose a player' });
    if (a.rez && !a.rez.nameFilter && !a.rez.highestCost && !a.rez.lowerCostThanSubject) {
      steps.push({ kind: 'grave', into: 'gravePicks', n: a.rez.n === 99 ? 0 : (a.rez.n || 1), upTo: !!a.rez.upTo, costMax: a.rez.max, typeFilter: a.rez.typeFilter || 'creature', dmGrave: a.rez.fromSide === 'dm', label: 'Choose creature(s) in the graveyard', skip: a.rez.n === 99 });
      if (a.rez.kwPick) steps.push({ kind: 'kws', from: a.rez.kwPick, n: 1, label: 'Choose a keyword' });
    }
    if (a.reclaim && !a.reclaim.random) steps.push({ kind: 'grave', into: 'gravePicks', n: a.reclaim.n || 1, costMax: a.reclaim.max, typeFilter: a.reclaim.typeFilter, tribe: a.reclaim.tribe, label: 'Choose a card in the graveyard' });
    if (a.copyC && (a.copyC.src === 'grave' || a.copyC.src === 'anywhere')) steps.push({ kind: 'grave', into: 'gravePicks', n: 1, typeFilter: 'creature', bothGraves: a.copyC.src === 'anywhere', label: 'Choose a creature to copy' });
    if (a.destroyT && !a.destroyT.side) steps.push({ kind: 'units', into: 'targets', n: a.destroyT.n || 1, upTo: !!a.destroyT.upTo, side: null, typeFilters: String(a.destroyT.filter).split(','), label: 'Choose what to destroy', allowEquips: String(a.destroyT.filter).includes('equip') });
    if (a.destroyT && a.destroyT.side === 'friendly') steps.push({ kind: 'units', into: 'targets', n: 1, side: mySd, typeFilters: String(a.destroyT.filter).split(','), label: 'Choose your persistent/tower to destroy' });
    if (a.peek && a.peek.deck === 'any') steps.push({ kind: 'deckChoice', label: 'Whose deck?' });
    if (a.redirectAttack && asReaction) steps.push({ kind: 'units', into: 'redirect', n: 1, side: null, label: 'Choose the new target of the attack' });
    if (a.flip) {
      // pre-collect targets for both branches (single-target ones)
      const ta = (a.flip.heads || []).concat(a.flip.tails || []).find(x => x.t && ['creature', 'friendly', 'enemy', 'any'].includes(x.t));
      if (ta) steps.push({ kind: 'units', into: 'targets', n: 1, side: ta.t === 'friendly' ? mySd : ta.t === 'enemy' ? enemySd : null, allowFace: ta.t === 'any', label: 'Choose a target (coin flip decides the outcome!)' });
    }
  }
  return steps.filter(s => !s.skip);
}
function labelFor(a, c) {
  if (a.dmg != null) return 'Choose a target for the damage';
  if (a.buffA != null || a.buffH != null) return (a.buffA < 0 || a.buffH < 0) ? 'Choose an enemy to weaken' : 'Choose a creature to buff';
  if (a.kw) return 'Choose a creature to enchant';
  if (a.healC) return 'Choose a creature to heal';
  return 'Choose a target';
}

function runStep() {
  const st = targeting.steps[targeting.si];
  if (!st) return finishPlay();
  if (st.kind === 'units') { st.picked = []; promptBar(`${targeting.card.name}: ${st.label} ${st.upTo ? '(up to ' + st.n + ')' : st.n > 1 ? '(' + st.n + ')' : ''}`, st.upTo || st.n > 1); markTargetables(); return; }
  if (st.kind === 'hand') { st.picked = []; promptBar(`${targeting.card.name}: ${st.label} — click cards in your hand`, true); markTargetables(); return; }
  if (st.kind === 'grave') return gravePickModal(st);
  if (st.kind === 'choice') return choiceModal(st);
  if (st.kind === 'kws') return kwModal(st);
  if (st.kind === 'player') return playerModal(st);
  if (st.kind === 'deckChoice') return deckChoiceModal(st);
  nextStep();
}
function nextStep() { targeting.si++; runStep(); }
function cancelTargeting() { targeting = null; armedAttacker = null; hidePromptBar(); render(); }

function finishPlay() {
  const t = targeting;
  targeting = null;
  hidePromptBar();
  if (t.asReaction) socket.emit('playReaction', t.payload);
  else socket.emit('playCard', t.payload);
}

// selection handlers
function onUnitClick(uidv) {
  const u = S.board.find(x => x.uid === uidv);
  if (!u) return;
  const st = targeting && targeting.steps[targeting.si];
  if (st && st.kind === 'units') {
    if (!unitValidForStep(u, st)) return toast('Invalid target');
    st.picked.push(u.uid);
    if (st.into === 'redirect') targeting.payload.redirectTo = u.uid;
    else targeting.payload[st.into] = (targeting.payload[st.into] || []).concat(u.uid);
    document.querySelectorAll(`[data-unit="${u.uid}"]`).forEach(x => x.classList.add('selected'));
    if (st.picked.length >= st.n) nextStep();
    else promptBar(`${targeting.card.name}: ${st.label} (${st.picked.length}/${st.n})`, st.upTo);
    return;
  }
  // attack arming
  if (isMyUnit(u) && myTurnNow() && S.turn.phase === 'attack' && clientCanAttack(u)) {
    armedAttacker = armedAttacker === u.uid ? null : u.uid;
    if (armedAttacker) promptBar(`⚔ ${u.name} — choose a target (enemy creature${enemyHasTaunt() ? ' with TAUNT' : ' or face'})`, false, true);
    else hidePromptBar();
    render();
    return;
  }
  if (armedAttacker && !isMyUnit(u)) {
    if (clientHasKw(u, 'noattack')) return toast('Cannot be targeted by attacks');
    if (enemyHasTaunt() && !clientHasKw(u, 'taunt')) return toast('You must attack a Taunt creature first');
    socket.emit('attack', { attacker: armedAttacker, target: u.uid });
    animateAttack(armedAttacker, u.uid);
    armedAttacker = null;
    hidePromptBar();
    return;
  }
  unitModal(u);
}
function enemyHasTaunt() {
  const enemySd = mySide() === 'party' ? 'dm' : 'party';
  return S.board.some(x => x.side === enemySd && clientHasKw(x, 'taunt'));
}
function onFaceClick(which) {
  const st = targeting && targeting.steps[targeting.si];
  if (st && st.kind === 'units' && st.allowFace) {
    targeting.payload[st.into] = targeting.payload[st.into] || [];
    targeting.payload.face = which; // informative; server dmg 'any' with no unit target → treat via targets empty? handle: use special
    // server's resolveTargets for 'any' uses explicit unit targets; face damage needs explicit path:
    targeting.payload.targets = targeting.payload.targets || [];
    targeting.payload.faceTarget = which;
    nextStep();
    return;
  }
  if (armedAttacker) {
    const enemyFace = mySide() === 'party' ? 'dm' : 'party';
    if (which !== enemyFace) return toast('Attack the enemy side');
    if (enemyHasTaunt()) return toast('You must attack a Taunt creature first');
    socket.emit('attack', { attacker: armedAttacker, target: 'face' });
    armedAttacker = null; hidePromptBar();
  }
}

function unitValidForStep(u, st) {
  if (st.side && u.side !== st.side) return false;
  if (st.typeFilters) {
    if (!st.typeFilters.includes(u.type) && !(st.allowEquips && u.equips.length)) return false;
  } else if (u.type !== 'creature' && !['tower', 'persistent'].includes(u.type)) return false;
  if (st.filter) {
    for (const part of String(st.filter).split(',')) {
      const [k, v] = part.split(':');
      if (k === 'tribe' && u.tribe !== v) return false;
      if (k === 'kw' && !clientHasKw(u, v)) return false;
      if (k === 'attacked' && u.attacksUsed === 0) return false;
      if (k === 'costMax' && ((card(u.cardId) || {}).cost || 0) > +v) return false;
      if (k === 'atkMin' && clientStats(u).atk < +v) return false;
      if (k === 'atkMax' && clientStats(u).atk > +v) return false;
      if (k === 'hpMax' && clientStats(u).effHp > +v) return false;
    }
  }
  if (st.spellTargeting && clientHasKw(u, 'nospell') && u.side !== mySide()) return false;
  if (st.picked && st.picked.includes(u.uid)) return false;
  return true;
}

function markTargetables() {
  document.querySelectorAll('.unit.targetable, .face-target.targetable').forEach(x => x.classList.remove('targetable'));
  const st = targeting && targeting.steps[targeting.si];
  if (st && st.kind === 'units') {
    for (const u of S.board) {
      if (unitValidForStep(u, st)) document.querySelectorAll(`[data-unit="${u.uid}"]`).forEach(x => x.classList.add('targetable'));
    }
    if (st.allowFace) { const f = mySide() === 'party' ? $('#dm-face') : $('#party-face'); if (f) f.classList.add('targetable'); const f2 = mySide() === 'party' ? $('#party-face') : $('#dm-face'); if (f2) f2.classList.add('targetable'); }
  }
  if (st && st.kind === 'hand') {
    $$('#my-hand .card').forEach(cd => { if (cd.dataset.inst !== targeting.payload.inst) cd.classList.add('targetable'); cd.onclick = () => { if (st.picked.includes(cd.dataset.inst)) return; st.picked.push(cd.dataset.inst); targeting.payload[st.into] = st.picked.slice(); cd.classList.add('selected'); if (st.picked.length >= st.n) nextStep(); }; });
  }
  if (armedAttacker) {
    const enemySd = mySide() === 'party' ? 'dm' : 'party';
    const taunt = enemyHasTaunt();
    for (const u of S.board.filter(x => x.side === enemySd)) {
      if (clientHasKw(u, 'noattack')) continue;
      if (taunt && !clientHasKw(u, 'taunt')) continue;
      if (u.type === 'creature' || u.type === 'tower' || u.type === 'persistent') document.querySelectorAll(`[data-unit="${u.uid}"]`).forEach(x => x.classList.add('targetable'));
    }
    if (!taunt) { const f = enemySd === 'dm' ? $('#dm-face') : $('#party-face'); if (f) f.classList.add('targetable'); }
  }
}

// prompt bar
function promptBar(text, withDone, noCancelReset) {
  const pb = $('#prompt-bar');
  pb.classList.remove('hidden');
  pb.innerHTML = `<span>${esc(text)}</span>
    ${withDone ? '<button id="pb-done" class="primary">Done</button>' : ''}
    <button id="pb-cancel">Cancel</button>`;
  const d = pb.querySelector('#pb-done');
  if (d) d.onclick = () => nextStep();
  pb.querySelector('#pb-cancel').onclick = cancelTargeting;
}
function hidePromptBar() { $('#prompt-bar').classList.add('hidden'); $('#prompt-bar').innerHTML = ''; }

// step modals
function gravePickModal(st) {
  const graves = st.dmGrave ? [['DM graveyard', S.dmGrave]] : st.bothGraves ? [['Party graveyard', S.grave], ['DM graveyard', S.dmGrave]] : [['Party graveyard', mySide() === 'party' ? S.grave : S.dmGrave]];
  const items = [];
  graves.forEach(([label, arr]) => arr.forEach((e, i) => items.push({ label, e, i })));
  const valid = (it) => {
    const c = card(it.e.cardId);
    if (!c || it.e.token) return false;
    if (st.typeFilter === 'creature' && !(c.type === 'creature')) return false;
    if (st.typeFilter && st.typeFilter !== 'creature' && c.type !== st.typeFilter) return false;
    if (st.costMax != null && (c.cost || 0) > st.costMax) return false;
    if (st.tribe && c.tribe !== st.tribe) return false;
    return true;
  };
  const sel = new Set();
  const m = modal(`<h3>${esc(targeting.card.name)}: ${esc(st.label)}</h3>
    <div class="m-cards">${items.map((it, idx) => `<div class="pick-item ${valid(it) ? '' : 'unplayable'}" data-idx="${idx}" data-hover="${it.e.cardId}">
      <b>${esc((card(it.e.cardId) || {}).name || it.e.name)}</b><div class="mini">${esc(it.label)} · cost ${(card(it.e.cardId) || {}).cost || 0}</div></div>`).join('') || '<p class="mini">Graveyard has no valid cards</p>'}</div>
    <div class="m-actions"><button id="gp-cancel">Cancel</button><button id="gp-ok" class="primary">Confirm</button></div>`, { sticky: true });
  m.querySelectorAll('.pick-item').forEach(pi => pi.onclick = () => {
    const it = items[+pi.dataset.idx];
    if (!valid(it)) return;
    if (sel.has(+pi.dataset.idx)) { sel.delete(+pi.dataset.idx); pi.classList.remove('selected'); }
    else if (sel.size < st.n) { sel.add(+pi.dataset.idx); pi.classList.add('selected'); }
  });
  m.querySelector('#gp-ok').onclick = () => {
    if (!st.upTo && sel.size < Math.min(st.n, items.filter(valid).length)) return toast(`Pick ${st.n}`);
    targeting.payload[st.into] = [...sel].map(idx => items[idx].i);
    closeModal(); nextStep();
  };
  m.querySelector('#gp-cancel').onclick = () => { closeModal(); cancelTargeting(); };
}
function choiceModal(st) {
  const m = modal(`<h3>${esc(targeting.card.name)}</h3>${st.options.map((o, i) => `<button style="display:block;width:100%;margin:4px 0" data-ch="${i}">${esc(o)}</button>`).join('')}`, { sticky: true });
  m.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => { targeting.payload.choice = +b.dataset.ch; closeModal(); nextStep(); });
}
function kwModal(st) {
  const sel = [];
  const m = modal(`<h3>${esc(st.label)}</h3><div class="m-cards">${st.from.map(k => `<div class="pick-item" data-kw="${k}">${k}</div>`).join('')}</div>
    <div class="m-actions"><button id="kw-ok" class="primary">Confirm</button></div>`, { sticky: true });
  m.querySelectorAll('[data-kw]').forEach(b => b.onclick = () => { if (sel.includes(b.dataset.kw)) return; sel.push(b.dataset.kw); b.classList.add('selected'); });
  m.querySelector('#kw-ok').onclick = () => { if (sel.length < st.n) return toast(`Pick ${st.n}`); targeting.payload.kwChoice = sel; closeModal(); nextStep(); };
}
function playerModal(st) {
  const m = modal(`<h3>${esc(st.label)}</h3>${S.players.map(p => `<button style="display:block;width:100%;margin:4px 0" data-pl="${p.id}">${esc(p.name)}</button>`).join('')}`, { sticky: true });
  m.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => { targeting.payload.targetPlayer = b.dataset.pl; closeModal(); nextStep(); });
}
function deckChoiceModal(st) {
  const m = modal(`<h3>Look at whose deck?</h3><button style="display:block;width:100%;margin:4px 0" data-dk="dm">DM's deck</button>
    ${S.players.map(p => `<button style="display:block;width:100%;margin:4px 0" data-dk="${p.id}">${esc(p.name)}'s deck</button>`).join('')}`, { sticky: true });
  m.querySelectorAll('[data-dk]').forEach(b => b.onclick = () => { targeting.payload.deckChoice = b.dataset.dk; closeModal(); nextStep(); });
}

// ---------- unit modal ----------
function unitModal(u) {
  const c = card(u.cardId) || { name: u.name, text: '' };
  const st = clientStats(u);
  const mine = isMyUnit(u);
  const act = c.activated;
  const m = modal(`<h3>${esc(u.name)} <span class="mini">(${esc(nameOf(u.owner))})</span></h3>
    <div class="mini">${esc(c.text || '')}</div>
    <p style="margin:8px 0"><b style="color:var(--accent)">${st.atk}</b> / <b style="color:var(--good)">${st.effHp}</b>${u.shield ? ` · 🛡${u.shield}` : ''} ${u.dmg ? `<span class="mini">(${u.dmg} damage marked)</span>` : ''}</p>
    ${allKws(u).length ? `<p class="mini">Keywords: ${kwChips(allKws(u))}</p>` : ''}
    ${u.poison.length ? `<p class="mini">☠️ Poison: ${u.poison.map(p => p.x + ' dmg, ' + p.rounds + ' rounds').join('; ')}</p>` : ''}
    ${u.equips.length ? `<p class="mini">🗡 Equipment: ${u.equips.map(e => esc(e.name) + (e.a ? ` +${e.a}atk` : '') + (e.h ? ` +${e.h}hp` : '')).join(', ')}</p>` : ''}
    ${u.suppressed ? '<p class="mini">🔇 Abilities suppressed</p>' : ''}${u.cantAttack ? `<p class="mini">🧊 Cannot attack for ${u.cantAttack} turn(s)</p>` : ''}
    <div class="m-actions">
      ${mine && act && !u.usedAbility ? `<button id="um-ability" class="primary">✨ ${esc(act.name)}</button>` : ''}
      ${S.isDM ? `
        <input type="number" id="um-atk" value="${st.atk}" style="width:64px" title="attack">
        <input type="number" id="um-hp" value="${st.effHp}" style="width:64px" title="health">
        <button id="um-set">Set stats</button>
        <button id="um-fire">Fire trigger</button>
        <button id="um-sup">${u.suppressTriggers ? 'Unsuppress' : 'Suppress'} triggers</button>
        <button id="um-kill" class="danger">Kill</button>
        <button id="um-exile" class="danger">Exile</button>` : ''}
      <button id="um-close">Close</button>
    </div>`);
  m.querySelector('#um-close').onclick = closeModal;
  const ab = m.querySelector('#um-ability');
  if (ab) ab.onclick = () => { closeModal(); startAbility(u, c); };
  if (S.isDM) {
    m.querySelector('#um-set').onclick = () => { socket.emit('dmAction', { op: 'editUnit', uid: u.uid, atk: +m.querySelector('#um-atk').value, hp: +m.querySelector('#um-hp').value }); closeModal(); };
    m.querySelector('#um-kill').onclick = () => { socket.emit('dmAction', { op: 'killUnit', uid: u.uid }); closeModal(); };
    m.querySelector('#um-exile').onclick = () => { socket.emit('dmAction', { op: 'exileUnit', uid: u.uid }); closeModal(); };
    m.querySelector('#um-sup').onclick = () => { socket.emit('dmAction', { op: 'suppressTriggers', uid: u.uid, on: !u.suppressTriggers }); closeModal(); };
    m.querySelector('#um-fire').onclick = () => {
      const trigs = ['play', 'death', 'attack', 'kill', 'startTurn', 'damaged', 'allyDeath', 'anyDeath'].filter(t => c[t]);
      if (!trigs.length) { toast('No structured triggers on this card'); return; }
      const mm = modal(`<h3>Fire trigger on ${esc(u.name)}</h3>${trigs.map(t => `<button style="display:block;width:100%;margin:4px 0" data-tg="${t}">${t}</button>`).join('')}`);
      mm.querySelectorAll('[data-tg]').forEach(b => b.onclick = () => { socket.emit('dmAction', { op: 'fireTrigger', uid: u.uid, trigger: b.dataset.tg }); closeModal(); });
    };
  }
}

function startAbility(u, c) {
  const fakeCard = { name: c.activated.name, cost2: c.activated.cost, play: c.activated.actions, type: 'ability' };
  const steps = buildSteps(fakeCard, false);
  targeting = { card: fakeCard, steps, si: 0, payload: {}, ability: { uid: u.uid } };
  targeting.finish = () => socket.emit('activate', { uid: u.uid, payload: targeting.payload });
  if (!steps.length) { socket.emit('activate', { uid: u.uid, payload: {} }); targeting = null; return; }
  runStep();
}
// patch finishPlay to support abilities
const _origFinishPlay = finishPlay;
finishPlay = function () {
  const t = targeting;
  if (t && t.ability) { targeting = null; hidePromptBar(); socket.emit('activate', { uid: t.ability.uid, payload: t.payload }); return; }
  _origFinishPlay();
};

// ---------- reaction prompt ----------
function renderPromptBar() {
  if (targeting || armedAttacker) return;
  const pr = S.pendingReaction;
  const pb = $('#prompt-bar');
  if (S.state === 'playing' && pr && pr.mine) {
    const kindTxt = pr.kind === 'spell' ? `✨ ${esc(pr.cardName || 'A spell')} is being cast` : pr.kind === 'attack' ? '⚔ An attack was declared' : `🃏 ${esc(pr.cardName || 'A creature')} entered play`;
    const myReactions = (S.hand || []).filter(h => { const c = card(h.cardId); return c && c.reaction && (c.reaction.on === pr.kind || c.reaction.on === 'any') && (c.cost || 0) <= myMana(); });
    pb.classList.remove('hidden');
    pb.innerHTML = `<span>${kindTxt} — react?</span>
      ${myReactions.map(h => `<button data-react="${h.inst}" data-hover="${h.cardId}">⚡ ${esc(card(h.cardId).name)} (${card(h.cardId).cost || 0})</button>`).join('')}
      <button id="pb-pass" class="primary">Pass</button>`;
    pb.querySelector('#pb-pass').onclick = () => socket.emit('reactPass');
    pb.querySelectorAll('[data-react]').forEach(b => b.onclick = () => {
      const h = (S.hand || []).find(x => x.inst === b.dataset.react);
      startPlay(card(h.cardId), h.inst, true);
    });
    return;
  }
  // discard-to-8 enforcement helper
  if (S.state === 'playing' && !S.isDM && myTurnNow() && (S.hand || []).length > 8) {
    pb.classList.remove('hidden');
    pb.innerHTML = `<span>Hand limit is 8 — click a card to discard</span>`;
    $$('#my-hand .card').forEach(cd => { cd.classList.add('targetable'); cd.onclick = () => socket.emit('discard', { inst: cd.dataset.inst }); });
    return;
  }
  if (!targeting) hidePromptBar();
}

// ---------- peek modal ----------
function peekModal(pk) {
  const opts = pk.opts || {};
  const order = pk.items.map((_, i) => i);
  const marked = { bottom: new Set(), exile: new Set(), take: new Set() };
  const renderList = (m) => {
    m.querySelector('#pk-list').innerHTML = order.map((idx, pos) => {
      const it = pk.items[idx];
      const c = card(it.cardId) || { name: it.cardId };
      const tags = [];
      if (marked.bottom.has(idx)) tags.push('⬇ bottom');
      if (marked.exile.has(idx)) tags.push('🕳 exile');
      if (marked.take.has(idx)) tags.push('✋ take');
      return `<div class="pick-item" data-hover="${it.cardId}" style="display:flex;gap:8px;align-items:center;margin:3px 0">
        ${opts.reorder ? `<span><button data-up="${pos}">▲</button><button data-dn="${pos}">▼</button></span>` : ''}
        <b>${esc(c.name)}</b> <span class="mini">cost ${c.cost || 0} · ${esc(c.type || '')}</span>
        <span class="spacer"></span>
        ${opts.bottom ? `<button data-bt="${idx}">bottom</button>` : ''}
        ${opts.exile ? `<button data-ex="${idx}">exile</button>` : ''}
        ${(opts.takeToHand || opts.keep) ? `<button data-tk="${idx}">take</button>` : ''}
        <span class="mini">${tags.join(' ')}</span>
      </div>`;
    }).join('');
    wire(m);
  };
  const wire = (m) => {
    m.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const p = +b.dataset.up; if (p > 0) { [order[p - 1], order[p]] = [order[p], order[p - 1]]; renderList(m); } });
    m.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => { const p = +b.dataset.dn; if (p < order.length - 1) { [order[p + 1], order[p]] = [order[p], order[p + 1]]; renderList(m); } });
    m.querySelectorAll('[data-bt]').forEach(b => b.onclick = () => { const i = +b.dataset.bt; toggleLimited(marked.bottom, i, opts.bottom); renderList(m); });
    m.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { const i = +b.dataset.ex; toggleLimited(marked.exile, i, opts.exile); renderList(m); });
    m.querySelectorAll('[data-tk]').forEach(b => b.onclick = () => { const i = +b.dataset.tk; toggleLimited(marked.take, i, opts.takeToHand || opts.keep || 1); renderList(m); });
  };
  const toggleLimited = (set, i, max) => { if (set.has(i)) set.delete(i); else if (set.size < (max || 1)) set.add(i); };
  const m = modal(`<h3>👁 ${esc(pk.title)}</h3>
    ${pk.kind === 'hand' ? '<div class="m-cards">' + pk.items.map(it => cardHtml(card(it.cardId) || { id: it.cardId, name: it.cardId, text: '', rarity: 'common' })).join('') + '</div><div class="m-actions"><button id="pk-ok" class="primary">Close</button></div>'
      : `<div id="pk-list"></div>
    <div class="m-actions">${opts.optional ? '<button id="pk-skip">Leave as is</button>' : ''}<button id="pk-ok" class="primary">Confirm</button></div>`}`, { sticky: true });
  if (pk.kind !== 'hand') renderList(m);
  m.querySelector('#pk-ok').onclick = () => {
    socket.emit('peekResolve', { token: pk.token, resp: { order: opts.reorder ? order : null, bottom: [...marked.bottom], exile: [...marked.exile], take: [...marked.take] } });
    closeModal();
  };
  const sk = m.querySelector('#pk-skip');
  if (sk) sk.onclick = () => { socket.emit('peekResolve', { token: pk.token, resp: {} }); closeModal(); };
}

function packModal(cards, tier) {
  modal(`<h3>🎁 ${esc(tier)} pack opened!</h3><div class="m-cards">${cards.map(id => cardHtml(card(id))).join('')}</div>
    <div class="m-actions"><button onclick="document.getElementById('modal-root').innerHTML=''" class="primary">Sweet!</button></div>`);
}

// ---------- animations ----------
function trackAnimations() {
  const cur = {};
  for (const u of S.board) cur[u.uid] = u.dmg;
  for (const [uidv, dmg] of Object.entries(cur)) {
    if (prevUnits[uidv] != null && dmg > prevUnits[uidv]) {
      document.querySelectorAll(`[data-unit="${uidv}"]`).forEach(x => { x.classList.add('hurt-flash'); setTimeout(() => x.classList.remove('hurt-flash'), 450); });
    }
  }
  prevUnits = cur;
}
function animateAttack(aUid) {
  document.querySelectorAll(`[data-unit="${aUid}"]`).forEach(x => x.classList.add('attacking'));
}

// ---------- COLLECTION ----------
function renderCollection() {
  const v = $('#view-collection');
  if (S.isDM) { v.innerHTML = '<div class="lobby"><p class="mini" style="padding:20px">The DM has the full card database — see DM Panel → Encounter decks & Give cards.</p></div>'; return; }
  const coll = S.collection || {};
  const ids = Object.keys(coll).filter(id => coll[id] > 0);
  let items = ids.map(id => card(id)).filter(Boolean);
  const f = collFilters;
  if (f.q) items = items.filter(c => (c.name + ' ' + c.text + ' ' + (c.tribe || '')).toLowerCase().includes(f.q.toLowerCase()));
  if (f.cls) items = items.filter(c => c.cls === f.cls);
  if (f.rarity) items = items.filter(c => c.rarity === f.rarity);
  if (f.fav) items = items.filter(c => (S.favorites || []).includes(c.id));
  items.sort((a, b) => f.sort === 'name' ? a.name.localeCompare(b.name) : f.sort === 'rarity' ? rOrd(b) - rOrd(a) : (a.cost || 0) - (b.cost || 0));
  const total = ids.reduce((s, id) => s + coll[id], 0);
  const byR = {}, byC = {};
  for (const id of ids) { const c = card(id); if (!c) continue; byR[c.rarity] = (byR[c.rarity] || 0) + coll[id]; byC[c.cls] = (byC[c.cls] || 0) + coll[id]; }
  v.innerHTML = `
    <div class="coll-tools">
      <input id="cf-q" placeholder="Search cards…" value="${esc(f.q)}">
      <select id="cf-cls"><option value="">All classes</option>${['commander', 'dps', 'wizard', 'sorcerer', 'crafter', 'neutral'].map(k => `<option ${f.cls === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
      <select id="cf-rar"><option value="">All rarities</option>${['starter', 'common', 'uncommon', 'rare', 'legendary'].map(k => `<option ${f.rarity === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
      <select id="cf-sort"><option value="cost" ${f.sort === 'cost' ? 'selected' : ''}>Sort: cost</option><option value="name" ${f.sort === 'name' ? 'selected' : ''}>Sort: name</option><option value="rarity" ${f.sort === 'rarity' ? 'selected' : ''}>Sort: rarity</option></select>
      <label class="chk"><input type="checkbox" id="cf-fav" ${f.fav ? 'checked' : ''}> ⭐ favorites</label>
      <span class="spacer"></span>
      <button id="coll-export">⬇ Export inventory</button>
      <button id="coll-import">⬆ Import</button>
      <button id="pstate-export">⬇ Export full state</button>
    </div>
    <div class="coll-stats">📦 ${total} cards, ${ids.length} unique · ${Object.entries(byR).map(([r, n]) => r + ': ' + n).join(' · ')} · ${Object.entries(byC).map(([r, n]) => r + ': ' + n).join(' · ')}</div>
    <div class="grid">${items.map(c => cardHtml(c, { count: coll[c.id], fav: (S.favorites || []).includes(c.id) })).join('') || '<p class="mini" style="padding:20px">No cards match. Pick a class in the lobby to get your starter collection.</p>'}</div>`;
  v.querySelector('#cf-q').oninput = (e) => { collFilters.q = e.target.value; renderCollection(); v.querySelector('#cf-q').focus(); const inp = v.querySelector('#cf-q'); inp.setSelectionRange(inp.value.length, inp.value.length); };
  v.querySelector('#cf-cls').onchange = (e) => { collFilters.cls = e.target.value; renderCollection(); };
  v.querySelector('#cf-rar').onchange = (e) => { collFilters.rarity = e.target.value; renderCollection(); };
  v.querySelector('#cf-sort').onchange = (e) => { collFilters.sort = e.target.value; renderCollection(); };
  v.querySelector('#cf-fav').onchange = (e) => { collFilters.fav = e.target.checked; renderCollection(); };
  v.querySelector('#coll-export').onclick = () => download('inventory.json', JSON.stringify({ type: 'inventory', collection: S.collection }, null, 2));
  v.querySelector('#coll-import').onclick = () => uploadJSON(data => socket.emit('importState', { data }));
  v.querySelector('#pstate-export').onclick = () => socket.emit('exportState', { scope: 'player' }, (data) => download('player-state.json', JSON.stringify(data, null, 2)));
  v.querySelectorAll('.grid .card').forEach(cd => cd.onclick = (e) => {
    if (e.target.dataset.fav) { socket.emit('favorite', { cardId: e.target.dataset.fav, on: !(S.favorites || []).includes(e.target.dataset.fav) }); return; }
    cardDetailModal(cd.dataset.cid);
  });
}
function rOrd(c) { return ['starter', 'common', 'uncommon', 'rare', 'legendary'].indexOf(c.rarity); }

function cardDetailModal(cid) {
  const c = card(cid);
  const m = modal(`<h3>${esc(c.name)}</h3>
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <div style="width:180px">${cardHtml(c)}</div>
      <div style="flex:1;min-width:220px">
        <p class="mini">${esc(c.cls)} · ${esc(c.arch || 'class staple')} · ${esc(c.set)} · <b>${esc(c.rarity)}</b> · ${esc(c.type)}${c.tribe ? ' · ' + esc(c.tribe) : ''}</p>
        <p style="margin:10px 0">${esc(c.text)}</p>
        ${c.kw && c.kw.length ? `<p class="mini">${c.kw.map(k => esc(KW_HELP[k.split(':')[0]] || k)).join('<br>')}</p>` : ''}
        ${c.manual ? '<p class="mini">⚠ This card\'s effect is resolved manually at the table.</p>' : ''}
        <div class="m-actions" style="justify-content:flex-start">
          ${!S.isDM ? `<button id="cd-art">🎨 Upload custom art</button>${S.art && S.art[cid] ? '<button id="cd-artclear">Remove art</button>' : ''}
          <button id="cd-gift">🎁 Gift a copy</button>` : ''}
        </div>
      </div>
    </div>
    <div class="m-actions"><button id="cd-close">Close</button></div>`);
  m.querySelector('#cd-close').onclick = closeModal;
  const ab = m.querySelector('#cd-art');
  if (ab) ab.onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const file = inp.files[0]; if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        // downscale to keep payload small
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement('canvas');
          const scale = Math.min(1, 360 / img.width);
          cv.width = img.width * scale; cv.height = img.height * scale;
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          socket.emit('setArt', { cardId: cid, dataUrl: cv.toDataURL('image/jpeg', 0.75) });
          toast('Card art updated!', true);
          closeModal();
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    };
    inp.click();
  };
  const ac = m.querySelector('#cd-artclear');
  if (ac) ac.onclick = () => { socket.emit('setArt', { cardId: cid, dataUrl: null }); closeModal(); };
  const gb = m.querySelector('#cd-gift');
  if (gb) gb.onclick = () => { closeModal(); giftModal(null, cid); };
}

function giftModal(toPid, presetCard) {
  const targets = S.players.filter(p => p.id !== ME.pid);
  if (!targets.length) return toast('No other players to gift to');
  const coll = S.collection || {};
  const owned = Object.keys(coll).filter(id => coll[id] > 0);
  const m = modal(`<h3>🎁 Send a gift</h3>
    <div class="dm-row"><label>To</label><select id="gf-to">${targets.map(p => `<option value="${p.id}" ${toPid === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    <div class="dm-row"><label>Card</label><select id="gf-card">${owned.map(id => `<option value="${id}" ${presetCard === id ? 'selected' : ''}>${esc((card(id) || {}).name)} (own ${coll[id]})</option>`).join('')}</select>
    <label>Count</label><input type="number" id="gf-n" value="1" min="1"></div>
    <div class="m-actions"><button id="gf-cancel">Cancel</button><button id="gf-send" class="primary">Send</button></div>`);
  m.querySelector('#gf-cancel').onclick = closeModal;
  m.querySelector('#gf-send').onclick = () => {
    const cards = {}; cards[m.querySelector('#gf-card').value] = +m.querySelector('#gf-n').value || 1;
    socket.emit('sendGift', { to: m.querySelector('#gf-to').value, cards });
    closeModal(); toast('Gift sent — awaiting acceptance', true);
  };
}

// ---------- DECKS ----------
function renderDecks() {
  const v = $('#view-decks');
  if (S.isDM) return renderDeckBuilder(v, true);
  renderDeckBuilder(v, false);
}

function renderDeckBuilder(v, forDM) {
  const coll = forDM ? null : (S.collection || {});
  const draft = forDM ? dmDeckDraft : deckDraft;
  const me = S.players.find(p => p.id === ME.pid) || {};
  let pool = Object.values(DB.cards).filter(c => !c.uncollectible);
  if (!forDM) pool = pool.filter(c => c.id === 'land_basic' || ((coll[c.id] || 0) > 0 && (c.cls === 'neutral' || c.cls === me.cls)));
  const f = collFilters;
  if (f.q) pool = pool.filter(c => (c.name + ' ' + c.text).toLowerCase().includes(f.q.toLowerCase()));
  if (f.cls && forDM) pool = pool.filter(c => c.cls === f.cls);
  pool.sort((a, b) => (a.cost || 0) - (b.cost || 0));
  const counts = {};
  for (const id of draft.cards) counts[id] = (counts[id] || 0) + 1;
  const curve = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const id of draft.cards) { const c = card(id); if (c && c.type !== 'land') curve[Math.min(7, c.cost || 0)]++; }
  const maxCurve = Math.max(1, ...curve);
  const decks = forDM ? (S.dmDecks || []) : (S.decks || []);

  v.innerHTML = `<div class="builder">
    <div class="builder-pool">
      <div class="coll-tools">
        <input id="db-q" placeholder="Search…" value="${esc(f.q)}">
        ${forDM ? `<select id="db-cls"><option value="">All classes</option>${['commander', 'dps', 'wizard', 'sorcerer', 'crafter', 'neutral'].map(k => `<option ${f.cls === k ? 'selected' : ''}>${k}</option>`).join('')}</select>` : ''}
        <span class="mini">${forDM ? 'Full card database (DM builds without owning cards)' : 'Click cards to add. Only your class + owned cards are legal.'}</span>
      </div>
      <div class="grid">${pool.map(c => cardHtml(c, { count: forDM ? undefined : (c.id === 'land_basic' ? undefined : coll[c.id]) })).join('')}</div>
    </div>
    <div class="builder-deck">
      <h3>${forDM ? '👹 Encounter deck' : '🃏 Deck'} builder</h3>
      <div class="dm-row"><input id="db-name" value="${esc(draft.name)}" style="flex:1"></div>
      <div class="mini">${draft.cards.length} cards ${forDM ? '(DM decks: 100+ recommended)' : '(30–60 required)'}</div>
      <div class="curve">${curve.map((n, i) => `<div class="bar" style="height:${(n / maxCurve) * 100}%"><span>${n || ''}</span><em>${i === 7 ? '7+' : i}</em></div>`).join('')}</div>
      <div style="margin:14px 0 6px">${Object.entries(counts).sort((a, b) => ((card(a[0]) || {}).cost || 0) - ((card(b[0]) || {}).cost || 0)).map(([id, n]) =>
    `<div class="deck-line" data-hover="${id}" data-rm="${id}"><span>${n}x ${esc((card(id) || {}).name)}</span><span class="mini">${(card(id) || {}).cost || 0}💧 ✖</span></div>`).join('') || '<p class="mini">Empty — click cards on the left</p>'}</div>
      <div class="dm-row">
        <button id="db-save" class="primary">💾 Save deck</button>
        <button id="db-lands">⛰️ Auto-fill lands</button>
        <button id="db-clear">Clear</button>
      </div>
      <div class="dm-row">
        <button id="db-export">⬇ Export deck</button>
        <button id="db-import">⬆ Import deck</button>
      </div>
      <h3 style="margin-top:14px">Saved decks</h3>
      ${decks.map(d => `<div class="deck-line"><span>${(forDM ? S.dm.activeDeck : S.activeDeck) === d.name ? '⭐ ' : ''}${esc(d.name)} <span class="mini">(${d.cards.length})</span></span>
        <span><button class="mini" data-load="${esc(d.name)}">Edit</button><button class="mini" data-use="${esc(d.name)}">Use</button><button class="mini" data-copy="${esc(d.name)}">Copy</button><button class="mini danger" data-del="${esc(d.name)}">✖</button></span></div>`).join('') || '<p class="mini">No saved decks</p>'}
    </div>
  </div>`;
  const qi = v.querySelector('#db-q');
  qi.oninput = (e) => { collFilters.q = e.target.value; renderDecks(); const i2 = $('#db-q'); i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); };
  const dc = v.querySelector('#db-cls');
  if (dc) dc.onchange = (e) => { collFilters.cls = e.target.value; renderDecks(); };
  v.querySelectorAll('.builder-pool .card').forEach(cd => cd.onclick = () => {
    const id = cd.dataset.cid;
    const have = counts[id] || 0;
    if (!forDM && id !== 'land_basic' && have >= (coll[id] || 0)) return toast(`You only own ${coll[id] || 0} copies`);
    if (!forDM && draft.cards.length >= 60) return toast('Deck limit is 60');
    draft.cards.push(id);
    draft.name = v.querySelector('#db-name').value;
    renderDecks();
  });
  v.querySelectorAll('[data-rm]').forEach(dl => dl.onclick = () => { const i = draft.cards.indexOf(dl.dataset.rm); if (i >= 0) draft.cards.splice(i, 1); draft.name = v.querySelector('#db-name').value; renderDecks(); });
  v.querySelector('#db-save').onclick = () => {
    draft.name = v.querySelector('#db-name').value.trim() || 'Deck';
    socket.emit('saveDeck', { name: draft.name, cards: draft.cards.slice(), overwrite: true });
    toast('Deck saved', true);
  };
  v.querySelector('#db-lands').onclick = () => {
    const target = Math.max(30, draft.cards.length);
    while (draft.cards.length < 30) draft.cards.push('land_basic');
    renderDecks();
  };
  v.querySelector('#db-clear').onclick = () => { draft.cards = []; renderDecks(); };
  v.querySelector('#db-export').onclick = () => download((draft.name || 'deck') + '.json', JSON.stringify({ type: 'deck', deck: { name: v.querySelector('#db-name').value, cards: draft.cards } }, null, 2));
  v.querySelector('#db-import').onclick = () => uploadJSON(data => {
    if (data.type === 'deck' && data.deck) { draft.name = data.deck.name; draft.cards = data.deck.cards.filter(id => card(id)); renderDecks(); toast('Deck loaded into builder', true); }
    else socket.emit('importState', { data });
  });
  v.querySelectorAll('[data-load]').forEach(b => b.onclick = () => { const d = decks.find(x => x.name === b.dataset.load); if (d) { draft.name = d.name; draft.cards = d.cards.slice(); renderDecks(); } });
  v.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { const d = decks.find(x => x.name === b.dataset.copy); if (d) { draft.name = d.name + ' (copy)'; draft.cards = d.cards.slice(); renderDecks(); toast('Copied as template', true); } });
  v.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { if (forDM) socket.emit('setDMDeck', { name: b.dataset.use }); else socket.emit('setActiveDeck', { name: b.dataset.use }); });
  v.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirmBox(`Delete deck "${b.dataset.del}"?`, () => socket.emit('deleteDeck', { name: b.dataset.del })));
}

// ---------- DM PANEL ----------
function renderDMPanel() {
  const v = $('#view-dm');
  const players = S.players.filter(p => !p.isDM);
  const cardOptions = Object.values(DB.cards).sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.id}">${esc(c.name)} (${c.cls})</option>`).join('');
  v.innerHTML = `<div class="dm-panel">
    <div class="dm-section"><h3>⚔ Encounter</h3>
      <div class="dm-row">
        ${S.state === 'playing' ? `<button id="dm-endbattle" class="danger">🏁 End battle & declare winner</button>
        <button id="dm-pause">${S.paused ? '▶ Unpause' : '⏸ Pause'}</button>` : ''}
        ${S.state !== 'playing' ? `<span class="mini">Start the encounter from the Board tab (lobby view).</span><button id="dm-tolobby">↩ Back to lobby</button>` : ''}
      </div>
      <div class="dm-row"><label>Party HP</label><input type="number" id="dm-php" value="${S.shared.hp}"><label>shield</label><input type="number" id="dm-pshield" value="${S.shared.shield}">
        <label>DM HP</label><input type="number" id="dm-dhp" value="${S.dm.hp}"><button id="dm-sethp">Apply</button></div>
      <div class="dm-row"><label>Pool mana</label><input type="number" id="dm-mpersist" value="${S.shared.manaPersist}"><label>burst</label><input type="number" id="dm-mburst" value="${S.shared.manaBurst}">
        <label>DM mana</label><input type="number" id="dm-dmana" value="${S.dm.mana || 0}"><button id="dm-setmana">Apply</button></div>
      <div class="dm-row"><button id="dm-skip">⏭ Skip phase</button>
        <label>Force turn:</label>${players.map(p => `<button data-force="${p.id}">${esc(p.name)}</button>`).join('')}<button data-force="dm">DM</button>
        ${S.pendingReaction ? '<button id="dm-forceres" class="danger">Force-resolve reaction</button>' : ''}</div>
    </div>
    <div class="dm-section"><h3>⏪ Undo / Rewind</h3>
      <div class="dm-row"><button id="dm-undo">↶ Undo</button><button id="dm-redo">↷ Redo</button>
      <select id="dm-rewind-sel">${(S.historyLabels || []).slice(-40).map(h => `<option value="${h.i}">${h.i}: ${esc(h.label)}</option>`).join('')}</select>
      <button id="dm-rewind" class="danger">⏪ Rewind to selected</button></div>
      <p class="mini">Every action snapshots the full game state. Undo steps back one action; rewind jumps further.</p>
    </div>
    <div class="dm-section"><h3>🃏 Give / remove cards</h3>
      <div class="dm-row"><label>Player</label><select id="dm-give-pid">${players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        <label>Card</label><select id="dm-give-card" style="max-width:240px">${cardOptions}</select>
        <label>N</label><input type="number" id="dm-give-n" value="1" min="1">
        <button id="dm-give">Give</button><button id="dm-remove" class="danger">Remove</button></div>
      <div class="dm-row"><label>Transfer:</label>
        <select id="dm-tr-from">${players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select> →
        <select id="dm-tr-to">${players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        <button id="dm-transfer">Transfer selected card</button></div>
      <div class="dm-row"><label>Starter deck:</label><select id="dm-st-pid">${players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        <select id="dm-st-cls">${Object.keys(DB.classes).map(k => `<option>${k}</option>`).join('')}</select>
        <select id="dm-st-arch"></select>
        <button id="dm-st-give">Give starter</button>
        <button id="dm-reset" class="danger">Reset collection</button></div>
    </div>
    <div class="dm-section"><h3>🎁 Pack generation</h3>
      <div class="dm-row">
        <label>Tier</label><select id="pk-tier"><option>common</option><option>uncommon</option><option>rare</option><option>legendary</option></select>
        <label>Size</label><input type="number" id="pk-size" value="5" min="1" max="15">
        <label>Packs</label><input type="number" id="pk-count" value="1" min="1" max="20">
        <label>Class</label><select id="pk-cls"><option value="">any</option>${['commander', 'dps', 'wizard', 'sorcerer', 'crafter'].map(k => `<option>${k}</option>`).join('')}</select>
        <label>Set</label><input id="pk-set" list="pk-sets" placeholder="any" style="width:130px">
        <datalist id="pk-sets">${[...new Set(Object.values(DB.cards).map(c => c.set))].sort().map(s => `<option value="${esc(s)}">`).join('')}</datalist>
        <label>To</label><select id="pk-pid">${players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      </div>
      <div class="dm-row">
        <label class="mini">Weight override (blank = default):</label>
        c <input type="number" step="0.05" id="pk-wc" style="width:60px"> u <input type="number" step="0.05" id="pk-wu" style="width:60px">
        r <input type="number" step="0.05" id="pk-wr" style="width:60px"> l <input type="number" step="0.05" id="pk-wl" style="width:60px">
      </div>
      <div class="dm-row"><button id="pk-preview">👁 Preview</button><button id="pk-give" class="primary">Generate & give</button></div>
      <div id="pk-result" class="mini"></div>
    </div>
    <div class="dm-section"><h3>📦 Move anything anywhere</h3>
      <div class="dm-row">
        <label>From</label>
        <select id="mv-fzone"><option value="hand">hand</option><option value="deck">deck (top)</option><option value="grave">graveyard</option><option value="exile">exile</option></select>
        <select id="mv-fwho"><option value="dm">DM</option>${players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        <select id="mv-fcard" style="max-width:220px"></select>
      </div>
      <div class="dm-row">
        <label>To</label>
        <select id="mv-tzone"><option value="hand">hand</option><option value="deck">deck top</option><option value="deckBottom">deck bottom</option><option value="board">board</option><option value="grave">graveyard</option><option value="exile">exile</option></select>
        <select id="mv-twho"><option value="dm">DM</option>${players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        <button id="mv-go" class="primary">Move</button>
      </div>
      <p class="mini">Tip: click any board unit to edit stats, kill, exile, fire or suppress its triggers. Click pile chips in the sidebar to move graveyard/exile cards.</p>
      <div class="dm-row"><label>Shuffle deck:</label><select id="mv-shwho"><option value="dm">DM</option>${players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button id="mv-shuffle">🔀 Shuffle</button>
      <button id="mv-viewdecks">👁 View decks & hands</button></div>
    </div>
    <div class="dm-section"><h3>💾 Campaign import/export</h3>
      <div class="dm-row"><button id="dm-exp">⬇ Export full campaign</button><button id="dm-imp">⬆ Import campaign</button></div>
    </div>
  </div>`;
  const q = (s) => v.querySelector(s);
  if (q('#dm-endbattle')) q('#dm-endbattle').onclick = () => {
    const m = modal(`<h3>Declare winner</h3><div class="m-actions">
      <button data-w="party">🧑‍🤝‍🧑 Party wins</button><button data-w="dm">👹 DM wins</button><button data-w="draw">Draw</button></div>`);
    m.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { socket.emit('dmAction', { op: 'endEncounter', winner: b.dataset.w }); closeModal(); });
  };
  if (q('#dm-pause')) q('#dm-pause').onclick = () => socket.emit('dmAction', { op: 'pause', on: !S.paused });
  if (q('#dm-tolobby')) q('#dm-tolobby').onclick = () => socket.emit('dmAction', { op: 'toLobby' });
  q('#dm-sethp').onclick = () => { socket.emit('dmAction', { op: 'editPartyHP', value: q('#dm-php').value }); socket.emit('dmAction', { op: 'editPartyShield', value: q('#dm-pshield').value }); socket.emit('dmAction', { op: 'editDMHP', value: q('#dm-dhp').value }); };
  q('#dm-setmana').onclick = () => { socket.emit('dmAction', { op: 'editMana', persist: q('#dm-mpersist').value, burst: q('#dm-mburst').value }); socket.emit('dmAction', { op: 'editDMMana', value: q('#dm-dmana').value }); };
  q('#dm-skip').onclick = () => socket.emit('dmAction', { op: 'skipPhase' });
  v.querySelectorAll('[data-force]').forEach(b => b.onclick = () => socket.emit('dmAction', { op: 'forceTurn', pid: b.dataset.force }));
  if (q('#dm-forceres')) q('#dm-forceres').onclick = () => socket.emit('dmAction', { op: 'forceResolve' });
  q('#dm-undo').onclick = () => socket.emit('dmAction', { op: 'undo' });
  q('#dm-redo').onclick = () => socket.emit('dmAction', { op: 'redo' });
  q('#dm-rewind').onclick = () => confirmBox('Rewind the game state? Later actions are kept in redo history.', () => socket.emit('dmAction', { op: 'rewind', idx: q('#dm-rewind-sel').value }));
  q('#dm-give').onclick = () => { const cards = {}; cards[q('#dm-give-card').value] = +q('#dm-give-n').value; socket.emit('dmAction', { op: 'giveCards', pid: q('#dm-give-pid').value, cards }); };
  q('#dm-remove').onclick = () => { const cards = {}; cards[q('#dm-give-card').value] = +q('#dm-give-n').value; socket.emit('dmAction', { op: 'removeCards', pid: q('#dm-give-pid').value, cards }); };
  q('#dm-transfer').onclick = () => { const cards = {}; cards[q('#dm-give-card').value] = +q('#dm-give-n').value; socket.emit('dmAction', { op: 'transferCards', from: q('#dm-tr-from').value, to: q('#dm-tr-to').value, cards }); };
  const updArch = () => { q('#dm-st-arch').innerHTML = Object.keys(DB.classes[q('#dm-st-cls').value].archetypes).map(a => `<option>${a}</option>`).join(''); };
  q('#dm-st-cls').onchange = updArch; updArch();
  q('#dm-st-give').onclick = () => socket.emit('dmAction', { op: 'giveStarter', pid: q('#dm-st-pid').value, cls: q('#dm-st-cls').value, arch: q('#dm-st-arch').value });
  q('#dm-reset').onclick = () => confirmBox('Reset this player\'s entire collection and decks?', () => socket.emit('dmAction', { op: 'resetCollection', pid: q('#dm-st-pid').value }));
  const pkOpts = () => {
    const w = { common: parseFloat(q('#pk-wc').value), uncommon: parseFloat(q('#pk-wu').value), rare: parseFloat(q('#pk-wr').value), legendary: parseFloat(q('#pk-wl').value) };
    const hasW = !isNaN(w.common) || !isNaN(w.uncommon) || !isNaN(w.rare) || !isNaN(w.legendary);
    const filter = {};
    if (q('#pk-cls').value) filter.cls = q('#pk-cls').value;
    if (q('#pk-set').value.trim()) filter.set = q('#pk-set').value.trim();
    return { tier: q('#pk-tier').value, size: +q('#pk-size').value, count: +q('#pk-count').value, filter, weights: hasW ? { common: w.common || 0, uncommon: w.uncommon || 0, rare: w.rare || 0, legendary: w.legendary || 0 } : null };
  };
  q('#pk-preview').onclick = () => socket.emit('dmAction', Object.assign({ op: 'genPacksPreview' }, pkOpts()));
  q('#pk-give').onclick = () => socket.emit('dmAction', Object.assign({ op: 'givePacks', pid: q('#pk-pid').value }, pkOpts()));
  socket.off('packPreview');
  socket.on('packPreview', ({ packs }) => {
    const pr = $('#pk-result');
    if (pr) pr.innerHTML = packs.map((p, i) => `Pack ${i + 1}: ` + p.map(id => `<span data-hover="${id}">${esc((card(id) || {}).name)}</span>`).join(', ')).join('<br>');
  });
  // move anything
  const refreshFrom = () => {
    const zone = q('#mv-fzone').value, who = q('#mv-fwho').value;
    let items = [];
    if (zone === 'hand') items = (who === 'dm' ? (S.hand || []) : (S.allHands[who] || [])).map((h, i) => ({ v: h.inst, label: (card(h.cardId) || {}).name }));
    if (zone === 'deck') items = (who === 'dm' ? (S.dmDeck || []) : (S.allDecks[who] || [])).map((id, i) => ({ v: i, label: i + ': ' + (card(id) || {}).name }));
    if (zone === 'grave') items = (who === 'dm' ? S.dmGrave : S.grave).map((e, i) => ({ v: i, label: e.name || e.cardId }));
    if (zone === 'exile') items = (who === 'dm' ? S.dmExile : S.exile).map((e, i) => ({ v: i, label: e.name || e.cardId }));
    q('#mv-fcard').innerHTML = items.map(it => `<option value="${it.v}">${esc(it.label)}</option>`).join('');
  };
  q('#mv-fzone').onchange = refreshFrom; q('#mv-fwho').onchange = refreshFrom; refreshFrom();
  q('#mv-go').onclick = () => {
    const zone = q('#mv-fzone').value, who = q('#mv-fwho').value, val = q('#mv-fcard').value;
    const from = { zone: zone === 'deck' ? 'deck' : zone, who };
    if (zone === 'hand') from.inst = val; else from.index = +val;
    socket.emit('dmAction', { op: 'moveCard', from, to: { zone: q('#mv-tzone').value, who: q('#mv-twho').value } });
  };
  q('#mv-shuffle').onclick = () => socket.emit('dmAction', { op: 'shuffleDeck', pid: q('#mv-shwho').value });
  q('#mv-viewdecks').onclick = () => dmSeeAllModal();
  q('#dm-exp').onclick = () => socket.emit('exportState', { scope: 'campaign' }, (data) => download('campaign.json', JSON.stringify(data, null, 2)));
  q('#dm-imp').onclick = () => uploadJSON(data => socket.emit('importState', { data }));
}

function dmSeeAllModal() {
  const deckChips = (who, deck) => deck.map((id, i) => `<span class="pile-chip" data-hover="${id}" data-deckwho="${who}" data-deckidx="${i}" title="Click: move to top/bottom (reorder)">${i + 1}. ${esc((card(id) || {}).name)}</span>`).join('') || '<span class="mini">empty</span>';
  const m = modal(`<h3>👁 All hidden information</h3>
    <p class="mini">Click any deck card to reorder it (move to top / bottom).</p>
    ${S.players.map(p => `<div class="pile-view"><h4>${esc(p.name)} — hand (${(S.allHands[p.id] || []).length})</h4>
      <div class="pile-cards">${(S.allHands[p.id] || []).map(h => `<span class="pile-chip" data-hover="${h.cardId}">${esc((card(h.cardId) || {}).name)}</span>`).join('') || '<span class="mini">empty</span>'}</div>
      <h4>${esc(p.name)} — deck order (${(S.allDecks[p.id] || []).length})</h4>
      <div class="pile-cards">${deckChips(p.id, S.allDecks[p.id] || [])}</div>
    </div>`).join('')}
    <div class="pile-view"><h4>DM deck order (${(S.dmDeck || []).length})</h4><div class="pile-cards">${deckChips('dm', S.dmDeck || [])}</div></div>
    <div class="m-actions"><button onclick="document.getElementById('modal-root').innerHTML=''">Close</button></div>`);
  m.querySelectorAll('[data-deckwho]').forEach(ch => ch.onclick = () => {
    const who = ch.dataset.deckwho, idx = +ch.dataset.deckidx;
    const mm = modal(`<h3>Reorder deck card</h3><div class="m-actions">
      <button id="rd-top">⬆ Move to top</button><button id="rd-bot">⬇ Move to bottom</button><button id="rd-cancel">Cancel</button></div>`);
    mm.querySelector('#rd-top').onclick = () => { socket.emit('dmAction', { op: 'moveCard', from: { zone: 'deck', who, index: idx }, to: { zone: 'deck', who } }); closeModal(); setTimeout(dmSeeAllModal, 250); };
    mm.querySelector('#rd-bot').onclick = () => { socket.emit('dmAction', { op: 'moveCard', from: { zone: 'deck', who, index: idx }, to: { zone: 'deckBottom', who } }); closeModal(); setTimeout(dmSeeAllModal, 250); };
    mm.querySelector('#rd-cancel').onclick = () => { closeModal(); dmSeeAllModal(); };
  });
}

function dmPileMenu(zone, who, idx) {
  const m = modal(`<h3>Move card</h3>
    <div class="dm-row"><label>To</label>
      <select id="pm-tzone"><option value="hand">hand</option><option value="deck">deck top</option><option value="deckBottom">deck bottom</option><option value="board">board</option><option value="grave">graveyard</option><option value="exile">exile</option></select>
      <select id="pm-twho"><option value="dm">DM</option>${S.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      <button id="pm-go" class="primary">Move</button></div>`);
  m.querySelector('#pm-go').onclick = () => {
    socket.emit('dmAction', { op: 'moveCard', from: { zone, who, index: idx }, to: { zone: m.querySelector('#pm-tzone').value, who: m.querySelector('#pm-twho').value } });
    closeModal();
  };
}

boot();
