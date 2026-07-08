# Deck & Dominion

An interactive, real-time card game platform for the **Deck Builder TTRPG** (design doc v1.4).
Cards are real, decks are treasure, and every fight is a card game. One DM hosts a session;
up to 6 players bring class decks that fight together as one party against DM-built encounter decks.

Built with Node.js + Express + Socket.IO, one in-memory session per table (import/export replaces
database persistence, per the feature list). All **738 cards** from the five class base sets are in
the database, with structured effects the engine automates; unusually complex cards are flagged
`manual` and resolve at the table with the DM god-tools.

## Running

```bash
npm install
npm start          # serves on $PORT (default 3000)
npm test           # end-to-end socket smoke test
```

## Deploying on Railway

1. Push this repo to GitHub and create a new Railway project → **Deploy from GitHub repo**.
2. Railway auto-detects Node (Nixpacks) and uses `npm start`; `railway.toml` sets the
   `/healthz` healthcheck. No environment variables or database are required — Railway
   injects `PORT` automatically.
3. Open the generated domain, click **Create session** as DM, and share the 4-letter code.

> Sessions live in server memory. If the service restarts, the DM re-imports the campaign file
> (DM Panel → Campaign import/export) — this is the intended persistence model.

## How a table plays

1. **DM** creates the session and gets a code. **Players** join with the code (or as spectators).
2. In the lobby each player picks a **class + archetype** and instantly receives the exact 30-card
   starter deck (and collection) from the design doc. Players ready up.
3. The DM builds an **encounter deck** from the full card database (Decks tab), sets party/DM HP
   (difficulty table from the design doc is shown), and starts the encounter.
4. Each round the **players choose their own turn order** — anyone can take the first turn, and each
   player passes to a teammate of their choice. After all players act, the DM takes a turn with
   draws/land-drops equal to the player count.
5. Turn phases: **Draw → Mana → Play → Attack → Resolution.** Lands tap for shared mana; spell mana
   is *burst* and expires at end of turn. Combat is Hearthstone-style with automated
   Taunt / First Strike / Trample / Lifelink / Deathtouch / Poison / Shield.
6. Reactions prompt automatically ("DM is casting Fireball — react?") when you hold a valid,
   affordable reaction card; one reaction resolves per trigger.
7. The encounter ends when a side hits 0 HP, or the DM ends the battle and declares a winner.
   Collections, decks, gifts, and card art carry over between encounters.

## Shared board, clear ownership

The board is one shared battlefield: DM forces on top (red frame), the party below. Party creatures
are **grouped per player** with a color-coded frame and nameplate; *your* group is gold-highlighted
and always listed first, so you can read the whole table at a glance but never lose track of what
you own. Hover any card or unit for a full-size preview; click for details, keywords, equipment,
buffs and (for the DM) direct edits.

## DM god-tools (DM Panel)

- Direct edits: party HP/shield, DM HP, mana pool, any creature's stats; kill/exile any unit.
- Move anything anywhere: any card between any hand / deck (top or bottom) / board / graveyard /
  exile of any player. Shuffle or inspect any deck; see all hands and deck orders.
- Trigger intervention: triggers fire automatically; the DM can undo one, fire one on demand, or
  suppress a card's triggers (unit click menu).
- Overrides: skip phases, force turns, force-resolve reaction windows, pause, **undo / redo /
  rewind** (every action snapshots the full game state).
- Give/remove/transfer cards, grant starter decks, reset collections.
- **Pack generation** with the tier table from the feature list (guaranteed slot + weighted rest),
  class filter, size, bulk count, weight overrides, and preview-before-give.
- Campaign export/import (all players' collections + decks + card art) as JSON.

## Player features

- Collection with search/filter/sort, counts, per-rarity/class stats, favorites, and
  **custom card art upload** (shared with the table, stored in the session/campaign export).
- Deck builder: 30–60 cards, class-restricted, ownership-checked, mana curve, auto-fill basic
  lands, save multiple decks, copy-as-template, JSON import/export (deck, inventory, or full
  player state).
- Gifting with accept/reject and a visible trade history.
- In-game: guided targeting prompts (valid targets highlighted), mulligan (up to 2),
  draw-or-keep at the 8-card hand limit, reaction prompts, graveyard/exile viewers,
  searchable & exportable combat log, in-game chat with DM whispers.
- Disconnects: state is held in memory; rejoin through the lobby with the same name (or same
  browser) to reclaim your seat.

## Rules interpretations baked into the engine

- **Haste** (per the design doc keyword table): attack twice this turn *and* may attack the turn
  it enters play. Other creatures can't attack the round they enter.
- Spell-generated mana is burst (expires end of turn); land/creature/tower mana persists until spent.
- Poison X: the creature takes X at the end of its owner's turn for 3 rounds.
- Tokens die into the graveyard for counting purposes but can't be resurrected or reclaimed.
- Cards whose text can't be safely automated are flagged **manual**: the play is logged with a ⚠
  banner and the table resolves it with DM edits (by design — this is a TTRPG tool, the DM is god).

## Project layout

```
server/
  index.js      Socket.IO session layer, DM ops, reaction windows, tailored state views
  engine.js     Game engine: turns, mana, combat, triggers, effect interpreter, undo history
  packs.js      Pack generation (tier table from the feature list)
  cards/        Full card database (commander/dps/wizard/sorcerer/crafter) + starter decks
public/         Single-page client (no build step): board, lobby, collection, decks, DM panel
test/smoke.js   End-to-end smoke test over real sockets
```
