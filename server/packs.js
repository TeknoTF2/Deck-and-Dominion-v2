// Pack generation per the feature list's tier table.
const { CARDS } = require('./cards');

const DEFAULT_WEIGHTS = {
  common:    { common: 0.85, uncommon: 0.15, rare: 0,    legendary: 0 },
  uncommon:  { common: 0.55, uncommon: 0.40, rare: 0.05, legendary: 0 },
  rare:      { common: 0.40, uncommon: 0.40, rare: 0.17, legendary: 0.03 },
  legendary: { common: 0.25, uncommon: 0.40, rare: 0.28, legendary: 0.07 },
};

function pool(filter = {}) {
  return Object.values(CARDS).filter(c => {
    if (c.type === 'land' || c.uncollectible) return false;
    if (filter.cls && c.cls !== filter.cls) return false;
    if (filter.set && c.set !== filter.set) return false;
    if (filter.arch && c.arch && c.arch !== filter.arch) return false;
    return true;
  });
}

function rarityOf(c) { return c.rarity === 'starter' ? 'common' : c.rarity; }

function pickByRarity(cards, rarity) {
  const opts = cards.filter(c => rarityOf(c) === rarity);
  if (!opts.length) return null;
  return opts[Math.floor(Math.random() * opts.length)];
}

function rollRarity(weights) {
  const r = Math.random();
  let acc = 0;
  for (const [rar, w] of Object.entries(weights)) { acc += w; if (r <= acc) return rar; }
  return 'common';
}

// tier: common|uncommon|rare|legendary; size: cards per pack; filter {cls,set,arch}; weights override
function generatePack(tier = 'common', size = 5, filter = {}, weightsOverride = null) {
  const cards = pool(filter);
  if (!cards.length) return [];
  const weights = weightsOverride || DEFAULT_WEIGHTS[tier] || DEFAULT_WEIGHTS.common;
  const out = [];
  // guaranteed slot
  const guaranteed = pickByRarity(cards, tier) || pickByRarity(cards, 'common');
  if (guaranteed) out.push(guaranteed.id);
  while (out.length < size) {
    let rar = rollRarity(weights);
    let c = pickByRarity(cards, rar) || pickByRarity(cards, 'common') || cards[Math.floor(Math.random() * cards.length)];
    if (c) out.push(c.id);
  }
  return out;
}

module.exports = { generatePack, DEFAULT_WEIGHTS };
