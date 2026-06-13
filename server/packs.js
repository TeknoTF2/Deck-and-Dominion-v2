// packs.js — booster pack generation (DM loot rewards).
import { allCards, RARITY_ORDER } from './cards.js';

// Per-tier rarity weights for the NON-guaranteed slots.
const TIER_WEIGHTS = {
  common: { common: 80, uncommon: 18, rare: 2, legendary: 0 },
  uncommon: { common: 45, uncommon: 45, rare: 9, legendary: 1 },
  rare: { common: 20, uncommon: 40, rare: 35, legendary: 5 },
  legendary: { common: 5, uncommon: 25, rare: 45, legendary: 25 },
};

const GUARANTEED = {
  common: 'common', uncommon: 'uncommon', rare: 'rare', legendary: 'legendary',
};

function pickWeighted(weights, pool) {
  // Build a flat weighted bag of rarities that actually have cards available.
  const available = {};
  for (const r of RARITY_ORDER) {
    if ((pool[r] || []).length) available[r] = weights[r] || 0;
  }
  const total = Object.values(available).reduce((a, b) => a + b, 0);
  if (total <= 0) {
    // fall back to any non-empty rarity
    const nonEmpty = RARITY_ORDER.filter((r) => (pool[r] || []).length);
    if (!nonEmpty.length) return null;
    const r = nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
    const arr = pool[r];
    return arr[Math.floor(Math.random() * arr.length)];
  }
  let roll = Math.random() * total;
  for (const [r, w] of Object.entries(available)) {
    roll -= w;
    if (roll <= 0) {
      const arr = pool[r];
      return arr[Math.floor(Math.random() * arr.length)];
    }
  }
  return null;
}

// filters: { class, set, archetype, includeLands }
export function generatePack({ tier = 'common', size = 5, filters = {}, weights = null } = {}) {
  const w = weights || TIER_WEIGHTS[tier] || TIER_WEIGHTS.common;
  let cards = allCards();
  if (!filters.includeLands) cards = cards.filter((c) => c.type !== 'land');
  if (filters.class) cards = cards.filter((c) => c.class === filters.class);
  if (filters.set) cards = cards.filter((c) => c.set === filters.set);
  if (filters.archetype) cards = cards.filter((c) => c.archetype === filters.archetype);

  const pool = { common: [], uncommon: [], rare: [], legendary: [] };
  for (const c of cards) (pool[c.rarity] || pool.common).push(c);

  const out = [];
  // guaranteed slot
  const gRarity = GUARANTEED[tier] || 'common';
  if ((pool[gRarity] || []).length) {
    const arr = pool[gRarity];
    out.push(arr[Math.floor(Math.random() * arr.length)].id);
  }
  while (out.length < size) {
    const card = pickWeighted(w, pool);
    if (!card) break;
    out.push(card.id);
  }
  return out;
}

export function bulkGenerate(count, opts) {
  const packs = [];
  for (let i = 0; i < count; i++) packs.push(generatePack(opts));
  return packs;
}

export { TIER_WEIGHTS };
export default { generatePack, bulkGenerate, TIER_WEIGHTS };
