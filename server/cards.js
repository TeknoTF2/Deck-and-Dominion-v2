// cards.js — loads the generated card database and exposes lookups + helpers.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');

const rawCards = JSON.parse(fs.readFileSync(path.join(DATA, 'cards.json'), 'utf8'));
const starterDecks = JSON.parse(fs.readFileSync(path.join(DATA, 'starterDecks.json'), 'utf8'));

const byId = new Map();
const byName = new Map();
for (const c of rawCards) {
  byId.set(c.id, c);
  byName.set(c.name.toLowerCase(), c);
}

export const CLASSES = ['Commander', 'Wizard', 'Sorcerer', 'DPS', 'Crafter'];
export const ARCHETYPES = {
  Commander: ['Marshal', 'Tactician', 'Warden'],
  Wizard: ['Enchanter', 'Illusionist', 'Abjurer'],
  Sorcerer: ['Necromancer', 'Dark Ritualist', 'Hexer'],
  DPS: ['Swarm', 'Big', 'Undead'],
  Crafter: ['Blacksmith', 'Farmer', 'Alchemist'],
};

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary'];

export function allCards() {
  return rawCards;
}
export function getCard(id) {
  return byId.get(id) || null;
}
export function getCardByName(name) {
  return byName.get(String(name || '').toLowerCase()) || null;
}
export function getStarterDecks() {
  return starterDecks;
}
export function getStarterDeck(id) {
  return starterDecks[id] || null;
}

// Find the canonical starter deck for a class+archetype.
export function starterFor(cls, archetype) {
  for (const d of Object.values(starterDecks)) {
    if (d.class === cls && d.archetype === archetype) return d;
  }
  return null;
}

// Expand a starter deck definition into a flat list of {cardId, copies} entries
// and into a collection seed { cardId: count }.
export function starterCollection(deckId) {
  const deck = starterDecks[deckId];
  const seed = {};
  if (!deck) return seed;
  for (const entry of deck.cards) {
    const card = getCardByName(entry.name);
    if (!card) continue;
    seed[card.id] = (seed[card.id] || 0) + entry.copies;
  }
  return seed;
}

// Build the ordered card-instance list for a deck definition (used in game).
export function expandStarterCardIds(deckId) {
  const deck = starterDecks[deckId];
  const ids = [];
  if (!deck) return ids;
  for (const entry of deck.cards) {
    const card = getCardByName(entry.name);
    if (!card) continue;
    for (let i = 0; i < entry.copies; i++) ids.push(card.id);
  }
  return ids;
}

// Lightweight deck validation against a player's collection + class rules.
export function validateDeck(deck, collection, ownerClass) {
  const errors = [];
  const total = deck.cards.reduce((s, e) => s + e.count, 0);
  if (total < 30) errors.push(`Deck has ${total} cards (minimum 30).`);
  if (total > 60) errors.push(`Deck has ${total} cards (maximum 60).`);
  for (const entry of deck.cards) {
    const card = getCard(entry.cardId);
    if (!card) { errors.push(`Unknown card ${entry.cardId}.`); continue; }
    // Class restriction: neutral cards (Basic Land) allowed for anyone.
    if (card.type !== 'land' && card.class && ownerClass && card.class !== ownerClass) {
      errors.push(`${card.name} is a ${card.class} card (your class is ${ownerClass}).`);
    }
    if (collection) {
      const owned = collection[entry.cardId] || 0;
      if (entry.count > owned) {
        errors.push(`You own ${owned}x ${card.name} but the deck has ${entry.count}.`);
      }
    }
  }
  return errors;
}

export default {
  allCards, getCard, getCardByName, getStarterDecks, getStarterDeck,
  starterFor, starterCollection, expandStarterCardIds, validateDeck,
  CLASSES, ARCHETYPES, RARITY_ORDER,
};
