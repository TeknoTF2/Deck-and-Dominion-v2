// ui.js — DOM helpers, card rendering, hover preview, modal + toast.
export function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...kids) { clear(el); for (const k of kids.flat()) if (k) el.append(k); return el; }

export function toast(msg, kind = '') {
  const root = document.getElementById('toast');
  const t = h('div', { class: 'toast-item ' + kind }, msg);
  root.append(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 2600);
}
export function notify(resp, okMsg) {
  if (resp && resp.error) toast(resp.error, 'err');
  else if (okMsg) toast(okMsg, 'ok');
  return resp;
}

const RARITY = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary' };
const KW_ABBR = { 'First Strike': 'FS', Haste: 'Haste', Trample: 'Tramp', Deathtouch: 'DT', Lifelink: 'LL', Taunt: 'Taunt' };

export function statLine(c) {
  if (c.attack != null && c.health != null) return `${c.attack}/${c.health}`;
  return '';
}

// Compact card tile for grids / collection / deck builder.
export function cardTile(c, opts = {}) {
  const tile = h('div', { class: `gcard rarity-${c.rarity}` },
    opts.count != null ? h('div', { class: 'cnt' }, '×' + opts.count) : null,
    opts.fav ? h('div', { class: 'fav' }, '★') : null,
    h('div', { class: 'cname' }, c.name),
    h('div', { class: 'ctext' }, c.text || ''),
    h('div', { class: 'cfoot' },
      c.cost != null ? h('div', { class: 'cost' }, c.cost) : h('div', { class: 'cost', style: { opacity: .4 } }, '–'),
      h('span', { class: 'pill' }, c.type),
      statLine(c) ? h('span', { class: 'stats' }, statLine(c)) : null,
    ),
  );
  attachHover(tile, c);
  if (opts.onClick) tile.addEventListener('click', opts.onClick);
  return tile;
}

let popEl;
export function attachHover(node, c) {
  if (!popEl) popEl = document.getElementById('cardpop');
  node.addEventListener('mouseenter', (e) => showPop(c, e));
  node.addEventListener('mousemove', (e) => positionPop(e));
  node.addEventListener('mouseleave', () => popEl.classList.add('hidden'));
}
function showPop(c, e) {
  popEl.classList.remove('hidden');
  popEl.innerHTML = '';
  popEl.append(
    h('div', { class: 'big-name' }, c.name),
    h('div', { class: 'meta' },
      h('span', { class: `pill cls-${c.class}` }, c.class || 'Neutral'),
      c.archetype ? h('span', { class: 'pill' }, c.archetype) : null,
      h('span', { class: 'pill', style: { color: `var(--${c.rarity})` } }, RARITY[c.rarity] || c.rarity),
      c.set ? h('span', { class: 'pill' }, c.set) : null,
    ),
    h('div', { class: 'meta' },
      c.cost != null ? h('span', { class: 'pill' }, '◆ ' + c.cost + ' mana') : null,
      statLine(c) ? h('span', { class: 'pill' }, statLine(c)) : null,
      h('span', { class: 'pill' }, c.type),
    ),
    (c.keywords && c.keywords.length) ? h('div', { class: 'meta' }, ...c.keywords.map((k) => h('span', { class: 'kwic' }, k))) : null,
    h('div', { class: 'big-text' }, c.text || '—'),
  );
  positionPop(e);
}
function positionPop(e) {
  const pad = 16, w = 240, hgt = popEl.offsetHeight || 160;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth) x = e.clientX - w - pad;
  if (y + hgt > innerHeight) y = innerHeight - hgt - pad;
  popEl.style.left = x + 'px'; popEl.style.top = y + 'px';
}

export function openModal(title, bodyBuilder, opts = {}) {
  const root = document.getElementById('modal-root');
  const close = () => clear(root);
  const body = h('div', {});
  const m = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === m && opts.dismissable !== false) close(); } },
    h('div', { class: 'modal', style: opts.style || {} },
      h('h2', {}, title, h('button', { class: 'close sm ghost', onclick: close }, '✕')),
      body,
    ),
  );
  clear(root); root.append(m);
  bodyBuilder(body, close);
  return close;
}

export function kwIcons(list) {
  return h('div', { class: 'kw' }, ...(list || []).map((k) => h('span', { class: 'kwic', title: k }, KW_ABBR[k] || k)));
}
