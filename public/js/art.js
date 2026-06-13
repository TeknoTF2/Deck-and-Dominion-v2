// art.js — shared card-art database: resolve, upload, and assign art.
import { store, action, card } from './store.js';
import { h, mount, toast, openModal } from './ui.js';

// URL for a stored art id (binary served over HTTP, not via socket state).
export function artUrl(artId) {
  if (!artId || !store.code) return null;
  return `/api/art/${store.code}/${artId}`;
}

// The art a given owner has chosen for a card (defaults to the viewer).
export function artFor(cardId, ownerId) {
  const sel = ownerId ? (store.artSelections[ownerId] || {}) : (store.you?.cardArt || {});
  return artUrl(sel[cardId]);
}

// Read a File -> data URL and POST it to the session art DB.
export async function uploadArtFile(file, name) {
  if (!file) return { error: 'No file.' };
  if (file.size > 3 * 1024 * 1024) return toast('Image too large (max 3 MB).', 'err');
  const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  const resp = await fetch(`/api/art/${store.code}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || file.name, by: store.you?.name, dataUrl }),
  }).then((r) => r.json()).catch(() => ({ error: 'Upload failed.' }));
  if (resp.error) toast(resp.error, 'err');
  return resp;
}

// Modal: pick art for one card (or just manage the gallery if no cardId).
export function openArtPicker(cardId) {
  const c = cardId ? card(cardId) : null;
  openModal(c ? `🎨 Art for ${c.name}` : '🎨 Shared Art Database', (body, close) => {
    const draw = () => {
      const current = c ? (store.you?.cardArt || {})[cardId] : null;
      const tiles = store.art.map((a) => h('div', {
        class: 'art-tile' + (a.id === current ? ' sel' : ''),
        title: a.name + (a.by ? ' · by ' + a.by : ''),
        onclick: () => { if (c) { action({ type: 'setCardArt', cardId, artId: a.id }); toast('Art set for ' + c.name); close(); } },
      },
        h('img', { src: artUrl(a.id), alt: a.name }),
        h('div', { class: 'art-name' }, a.name),
        h('button', { class: 'art-del sm ghost', title: 'Delete from shared DB', onclick: (e) => { e.stopPropagation(); if (confirm('Remove this art from the shared database?')) action({ type: 'deleteArt', artId: a.id }); } }, '✕'),
      ));
      const fileIn = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
      fileIn.addEventListener('change', async () => {
        const f = fileIn.files[0]; if (!f) return;
        const name = prompt('Name this art:', f.name.replace(/\.[^.]+$/, '')) || f.name;
        const r = await uploadArtFile(f, name);
        if (r && r.id) { toast('Uploaded'); if (c) { action({ type: 'setCardArt', cardId, artId: r.id }); close(); } }
      });
      mount(body,
        h('div', { class: 'muted', style: { marginBottom: '10px' } },
          'Upload images to the shared database; anyone in the session can pick them for their own cards. Art travels with campaign export/import.'),
        h('div', { class: 'row', style: { marginBottom: '10px' } },
          h('button', { class: 'primary', onclick: () => fileIn.click() }, '⬆ Upload new art'),
          c && current ? h('button', { onclick: () => { action({ type: 'setCardArt', cardId, artId: null }); toast('Art cleared'); close(); } }, 'Use default') : null,
          fileIn,
        ),
        store.art.length ? h('div', { class: 'art-grid' }, ...tiles) : h('div', { class: 'muted center', style: { padding: '20px' } }, 'No art uploaded yet.'),
      );
    };
    draw();
  }, { style: { width: '640px' } });
}
