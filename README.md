# Deck & Dominion

An interactive, real‑time card game for the **Deck‑Builder TTRPG** — a cooperative
deck‑building RPG where all conflict is resolved through card duels. A party of
players (each a unique class) shares one HP pool, mana pool, board, and graveyard,
and faces a Dungeon Master controlling encounter decks.

This repository contains a complete, deployable web app: a Node game server with a
real‑time multiplayer engine, the full **736‑card** database parsed from the design
documents, and a browser client (lobby, collection, deck builder, battle board, and
a full DM control panel).

---

## Quick start (local)

```bash
npm install
npm start
# open http://localhost:3000
```

The first person creates a session **as the DM** and shares the 4‑letter code.
Players join with the code, pick a class + archetype (which grants a 30‑card
starter deck and collection), ready up, and the DM starts the encounter.

Run the end‑to‑end test suite (boots a server and drives a full game over sockets):

```bash
npm test
```

---

## Deploy to Railway

This app is Railway‑ready out of the box.

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo** and select it.
3. Railway auto‑detects Node (Nixpacks), runs `npm install`, and starts with
   `npm start` (see `railway.json` / `Procfile`).
4. The server binds to `process.env.PORT` automatically — no config needed.
5. Open the generated domain. Done.

No database is required: per the design, **state is held in memory during a session**
and persistence is handled through **import/export** (player state and full campaign
files). For long‑running deployments, attach a Railway volume only if you later add
disk persistence.

> **Card database:** `data/cards.json` and `data/starterDecks.json` are committed,
> so the server needs no Python at runtime. To regenerate them from the `.docx`
> sources, run `pip install python-docx && npm run build:cards`.

---

## Architecture

```
server/
  index.js     HTTP + Socket.IO; routes every action; per‑recipient state redaction
  session.js   Lobby, players, collections, decks, gifting, import/export, start battle
  game.js      Authoritative engine: zones, turns, mana, combat, keywords, DM controls,
               snapshot/undo. All state lives in one clonable object for rewind.
  cards.js     Loads the card DB; deck validation; starter expansion
  effects.js   Effect interpreter — parses common card text into automated ops
  packs.js     Weighted booster‑pack generation
data/
  cards.json         736 parsed cards (id, class, archetype, set, rarity, cost,
                     type, attack/health, keywords, text)
  starterDecks.json  15 starter decks (one per class×archetype) with copy counts
public/        Browser SPA (ES modules, no build step)
  js/store.js  socket + global state + card DB
  js/ui.js     DOM helpers, card rendering, hover preview, modals, toasts
  js/views.js  home, lobby, collection, deck builder
  js/game.js   battle board, hand, combat/targeting interaction
  js/dm.js     encounter deck builder, pack generation, in‑game DM panel
  js/main.js   app shell + routing
tools/build_cards.py   regenerates the card DB from the .docx design files
tests/e2e.mjs          socket‑level end‑to‑end test (npm test)
```

### Design philosophy: DM‑mediated automation

The feature list specifies **exception‑based DM intervention**: triggers fire
automatically, but the DM can undo, manually fire, suppress, edit any number, and
move any card anywhere. The engine follows this faithfully:

- **Automated:** mana/tap/untap, playing cards, summoning sickness, the combat
  keyword set (First Strike, Trample, Deathtouch, Lifelink, Taunt, Shield, Poison),
  damage/draw/mana/heal/buff/debuff/token/keyword‑grant effects, start‑of‑turn
  tower/plant effects, poison ticks, win conditions, zones, equipment, snapshots.
- **DM‑resolved (flagged, not blocked):** cards with complex or unique wording are
  played normally (the creature hits the board / the spell hits the graveyard) and a
  **gold line appears in the combat log** prompting manual resolution. The DM then
  uses Direct Edits / Move Card / Spawn Card / stat editors to apply the effect.
  This matches the "Trigger Intervention (Exception‑Based)" feature exactly and keeps
  every one of the 736 cards playable without hard‑coding 736 effects.

A couple of explicit rules interpretations (documented so they're easy to change):
- **Haste** = may attack the turn it enters **and** may attack twice (per the keyword
  table). Other "may attack again" cards are DM‑resolved.
- **Summoning sickness** applies to non‑Haste creatures (consistent with the many
  "gains Haste / can attack immediately" cards).

---

## Feature coverage (vs. Complete Feature List)

**Game Engine** — shared HP/mana/board/graveyard ✓ · player hands/decks/collections ✓ ·
turn order chosen each round + phase progression (Draw→Mana→Play→Attack→Resolution) ✓ ·
DM turn draws/lands = player count ✓ · hand context ✓ · tap/untap + shared pool +
burst mana expiry ✓ · combat (attacker chooses target, Taunt, First Strike,
simultaneous damage, Trample, Lifelink, Deathtouch, Poison‑3‑rounds, Shield) ✓ ·
triggers on‑play/start‑of‑turn/death + DM manual/suppress ✓ · reactions (play off‑turn,
hold mana) ✓ · tokens ✓ · equipment (incl. Death Knight multi‑slots) ✓ · targeting with
highlight + validation ✓ · keywords automated ✓ · zones hand/deck/board/graveyard/exile ✓ ·
copies/sacrifice/resurrection via DM move + automated subset ✓ · game end (HP 0 or DM
declares winner) ✓.

**DM Controls** — direct edits of any number ✓ · move anything between zones/players ✓ ·
reorder decks ✓ · see all hands/decks/hidden info ✓ · undo/redo/rewind (snapshots) ✓ ·
suppress triggers ✓ · give/remove/transfer cards, give starters, reset collection ✓ ·
pack generation (tiers, guaranteed slot, weights, size, class filter, preview, bulk) ✓ ·
build encounter decks without owning, save/load, auto‑filler ✓ · start/end encounter,
kick, declare winner, set active turn ✓.

**Player Features** — collection view with filter/search/sort, counts, rarity stats,
favorites ✓ · deck building from owned cards, 30–60 limit, class enforcement, multiple
decks, mana curve, auto‑fill lands, import/export ✓ · starter deck on class+archetype
select ✓ · gifting with accept/reject ✓ · in‑game: play cards, target selection, declare
attacks/targets, reactions, mulligan (≤2), pass turn, view zones ✓.

**Card‑art database** — players upload images from the web UI to a **shared** per‑session
art database; any player can pick any uploaded art for **their own** cards. Art renders on
collection tiles, hand cards, hover previews, and on the battle board (each creature uses
its owner's chosen art). Binary images are served over HTTP (`/api/art/:code/:id`) and kept
out of the realtime state; selections travel with player export and the bytes travel with
campaign export/import. Open via **Collection → 🎨 Art Database** or a card's **🎨 Set Art**.

**Session / UI / QOL** — lobby with join code, class/deck select, ready, spectators ✓ ·
import/export player + full campaign ✓ · in‑game chat + DM whisper (`/w name …`) ✓ ·
board with stats/keyword icons/equipment/shield/poison badges, HP/mana, turn & phase ✓ ·
hover‑to‑enlarge + click detail + keyword tooltips + highlight valid targets ✓ ·
searchable combat log ✓ · undo + confirms ✓ · mana curve, auto‑lands, tap for mana,
auto‑damage, basic animations ✓.

**Edge cases** — infinite‑loop / any state stoppable via DM override & undo ✓ ·
disconnect mid‑session → rejoin via the same browser (state held in memory) ✓.

Items intentionally left to the DM's manual tools (by design): a few highly unique
one‑off card effects, which are played onto the board/graveyard normally and flagged
gold in the log for manual resolution.

---

## How to play (TL;DR)

- **DM:** create session → set difficulty → (optionally) build an encounter deck →
  Start Encounter. In battle, use the **DM Override** panel to edit anything, the gold
  log lines tell you which cards need a manual ruling, and Undo fixes any mistake.
- **Players:** join with the code → pick class + archetype → build/choose a deck in the
  **Decks** tab → Ready. In battle, click a hand card to play (you'll be prompted to
  pick a target when needed), and click your creature then an enemy/face to attack.
- **End your turn** and choose which teammate goes next; after everyone, the DM plays.

The party wins when the DM hits 0 HP (or the DM declares a winner per the encounter's
victory condition). The party loses if shared HP hits 0.
