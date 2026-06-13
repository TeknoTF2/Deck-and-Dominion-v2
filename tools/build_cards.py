#!/usr/bin/env python3
"""
build_cards.py — Parse the Deck & Dominion .docx design/card files into a
structured JSON card database (data/cards.json) and starter-deck definitions
(data/starterDecks.json).

Run once locally (the server only reads the generated JSON):
    pip install python-docx
    python3 tools/build_cards.py
"""
import os, re, json, glob
import docx
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.oxml.ns import qn

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

# filename fragment -> class name
CLASS_FILES = {
    "commander-base-set": "Commander",
    "wizard-base-set": "Wizard",
    "sorcerer-base-set": "Sorcerer",
    "dps-base-set": "DPS",
    "crafter-base": "Crafter",
}

# Archetypes per class (UPPER form used in headings)
ARCHETYPES = {
    "Commander": ["MARSHAL", "TACTICIAN", "WARDEN"],
    "Wizard": ["ENCHANTER", "ILLUSIONIST", "ABJURER"],
    "Sorcerer": ["NECROMANCER", "DARK RITUALIST", "HEXER"],
    "DPS": ["SWARM", "BIG", "UNDEAD"],
    "Crafter": ["BLACKSMITH", "FARMER", "ALCHEMIST"],
}

KEYWORDS = ["Haste", "Trample", "Deathtouch", "Lifelink", "First Strike", "Taunt"]


def iter_blocks(doc):
    for child in doc.element.body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, doc)
        elif child.tag == qn("w:tbl"):
            yield Table(child, doc)


def heading_level(p):
    s = p.style.name if p.style else ""
    if s.startswith("Heading") and s[-1].isdigit():
        return int(s[-1])
    if s == "Title":
        return 0
    return None


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def parse_stats(text):
    m = re.search(r"\b(\d+)\s*/\s*(\d+)\b", text)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def extract_keywords(text):
    found = []
    for kw in KEYWORDS:
        if re.search(r"\b" + re.escape(kw) + r"\b", text):
            found.append(kw)
    m = re.search(r"\bShield\s+(\d+)\b", text)
    if m:
        found.append("Shield " + m.group(1))
    m = re.search(r"\bPoison\s+(\d+)\b", text)
    if m:
        found.append("Poison " + m.group(1))
    return found


def infer_type(name, cost_raw, stats, effect):
    blob = (effect or "")
    low = blob.lower()
    if name.strip().lower() == "basic land":
        return "land"
    if re.search(r"\bequipment\b", low) and (
        "equipment:" in low or "equipment." in low or low.startswith("equipment")
    ):
        return "equipment"
    if re.search(r"\btower\b", low):
        return "tower"
    if re.search(r"\bpersistent\b", low):
        return "persistent"
    if stats[0] is not None:
        return "creature"
    return "spell"


def rarity_from_heading(text):
    t = text.lower()
    if "legendary" in t:
        return "legendary"
    if "rare" in t:
        return "rare"
    if "uncommon" in t:
        return "uncommon"
    if "starter" in t:
        return "starter"
    if "common" in t:
        return "common"
    if "stapl" in t:
        return "staple"
    return None


def set_name_from_heading(text):
    # Forms: "Starter: Sergeant", "Uncommon Aggressive: Vanguard",
    # "Spiders — Common (Starter)", "Common Expansion: Tribal", "Starter Deck (30 cards)"
    if "—" in text or "–" in text:
        return re.split(r"[—–]", text)[0].strip()
    if ":" in text:
        return text.split(":", 1)[1].strip()
    return re.sub(r"\(.*?\)", "", text).strip()


def parse_table(tbl):
    rows = []
    for r in tbl.rows:
        rows.append([c.text.strip().replace("\n", " ") for c in r.cells])
    if not rows:
        return None, []
    header = [h.strip() for h in rows[0]]
    hl = [h.lower() for h in header]
    if "cost" not in hl:
        return None, []  # not a card table

    def col(*names):
        for n in names:
            if n in hl:
                return hl.index(n)
        return None

    idx = {
        "name": col("card", "name") or 0,
        "cost": col("cost"),
        "stats": col("stats"),
        "effect": col("effect", "ability", "description"),
        "copies": col("copies"),
    }
    return idx, rows[1:]


# Design-doc starter-deck label -> (class, archetype, deckId)
STARTER_LABELS = {
    "marshal": ("Commander", "Marshal"),
    "tactician": ("Commander", "Tactician"),
    "warden": ("Commander", "Warden"),
    "spider": ("DPS", "Swarm"),
    "ogre": ("DPS", "Big"),
    "undead": ("DPS", "Undead"),
    "abjurer": ("Wizard", "Abjurer"),
    "enchanter": ("Wizard", "Enchanter"),
    "illusionist": ("Wizard", "Illusionist"),
    "necromancer": ("Sorcerer", "Necromancer"),
    "ritualist": ("Sorcerer", "Dark Ritualist"),
    "hexer": ("Sorcerer", "Hexer"),
    "farmer": ("Crafter", "Farmer"),
    "blacksmith": ("Crafter", "Blacksmith"),
    "alchemist": ("Crafter", "Alchemist"),
}


def parse_design_starters(cards):
    """Parse all 15 starter decks from the design document (authoritative,
    includes copy counts). Backfills any referenced card missing from `cards`."""
    starter = {}
    path = glob.glob(os.path.join(ROOT, "*design-doc*.docx"))
    if not path:
        return starter
    doc = docx.Document(path[0])
    last_label = ""
    for block in iter_blocks(doc):
        if isinstance(block, Paragraph):
            t = block.text.strip()
            if t:
                last_label = t
            continue
        if "starter deck" not in last_label.lower():
            continue
        # identify class/archetype from the label
        low = last_label.lower()
        match = None
        for key, ca in STARTER_LABELS.items():
            if key in low:
                match = ca
                break
        if not match:
            continue
        cls, arch = match
        did = slug(cls + "-" + arch)
        idx, body = parse_table(block)
        if not idx:
            continue
        dname = re.sub(r"\s*\(.*?\)\s*", "", last_label).rstrip(":").strip()
        deck = {"id": did, "name": dname,
                "class": cls, "archetype": arch, "cards": []}
        for row in body:
            def cell(key):
                i = idx.get(key)
                return row[i].strip() if (i is not None and i < len(row)) else ""
            name = cell("name")
            if not name or name.lower() == "card":
                continue
            cp = 1
            mc = re.match(r"\d+", cell("copies"))
            if mc:
                cp = int(mc.group(0))
            deck["cards"].append({"name": name, "copies": cp})
            # backfill missing card into DB
            sl = slug(name)
            if sl not in cards:
                effect = cell("effect")
                stats_cell = cell("stats")
                a, h = parse_stats(stats_cell) if stats_cell else parse_stats(effect)
                cost = None
                m = re.match(r"-?\d+", cell("cost"))
                if m:
                    cost = int(m.group(0))
                cards[sl] = {
                    "id": sl, "name": name, "class": cls,
                    "archetype": None if cls in name or "staple" in low else arch,
                    "set": cls + " Staples", "rarity": "common", "cost": cost,
                    "type": infer_type(name, cell("cost"), (a, h), effect),
                    "attack": a, "health": h,
                    "keywords": extract_keywords(effect + " " + stats_cell),
                    "text": effect,
                }
        starter[did] = deck
    return starter


def main():
    cards = {}       # slug -> card dict (deduped by name)
    report = []

    for path in sorted(glob.glob(os.path.join(ROOT, "*.docx"))):
        base = os.path.basename(path).lower()
        cls = None
        for frag, c in CLASS_FILES.items():
            if frag in base:
                cls = c
                break
        if not cls:
            continue
        doc = docx.Document(path)
        cur_arch = None        # archetype display name or None for staples
        cur_set = None
        cur_rarity = None
        in_staples = False

        for block in iter_blocks(doc):
            if isinstance(block, Paragraph):
                lvl = heading_level(block)
                if lvl is None:
                    continue
                text = block.text.strip()
                up = text.upper()
                # archetype heading?
                matched_arch = None
                for a in ARCHETYPES[cls]:
                    if up.startswith(a):
                        matched_arch = a
                        break
                if matched_arch and lvl <= 1:
                    cur_arch = matched_arch.title() if matched_arch != "DPS" else matched_arch
                    cur_arch = matched_arch.title()
                    in_staples = False
                    cur_set = None
                    cur_rarity = None
                    continue
                if "stapl" in text.lower():
                    in_staples = True
                    cur_arch = None
                    cur_set = cls + " Staples"
                    cur_rarity = "common"
                    continue
                # set / rarity heading (H2 typically)
                rar = rarity_from_heading(text)
                if rar and lvl is not None and lvl >= 2:
                    in_staples = False
                    cur_rarity = rar if rar != "starter" else "common"
                    cur_set = set_name_from_heading(text)
                continue

            # table
            idx, body = parse_table(block)
            if not idx:
                continue
            for row in body:
                def cell(key):
                    i = idx.get(key)
                    if i is None or i >= len(row):
                        return ""
                    return row[i].strip()

                name = cell("name")
                if not name or name == "-" or name.lower() in ("card", "components", "support spells", "payoff"):
                    continue
                cost_raw = cell("cost")
                effect = cell("effect")
                stats_cell = cell("stats")
                copies = cell("copies")

                # stats: prefer Stats column, else dig out of effect
                a, h = parse_stats(stats_cell) if stats_cell else (None, None)
                if a is None:
                    a, h = parse_stats(effect)

                cost = None
                m = re.match(r"-?\d+", cost_raw)
                if m:
                    cost = int(m.group(0))

                ctype = infer_type(name, cost_raw, (a, h), effect)
                kws = extract_keywords(effect + " " + stats_cell)

                sl = slug(name)
                if sl in cards:
                    continue  # dedupe by name; keep first (canonical) definition

                cards[sl] = {
                    "id": sl,
                    "name": name,
                    "class": cls,
                    "archetype": cur_arch if not in_staples else None,
                    "set": cur_set or (cls + " Staples"),
                    "rarity": cur_rarity or "common",
                    "cost": cost,
                    "type": ctype,
                    "attack": a,
                    "health": h,
                    "keywords": kws,
                    "text": effect,
                }

        report.append((cls, path))

    # Starter decks come from the design doc (authoritative, with copy counts).
    starter = parse_design_starters(cards)

    card_list = list(cards.values())
    # stable id collision guard
    seen = set()
    for c in card_list:
        cid = c["id"]
        n = 1
        while cid in seen:
            n += 1
            cid = c["id"] + "-" + str(n)
        c["id"] = cid
        seen.add(cid)

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "cards.json"), "w") as f:
        json.dump(card_list, f, indent=1)
    with open(os.path.join(DATA, "starterDecks.json"), "w") as f:
        json.dump(starter, f, indent=1)

    # report
    by_class = {}
    by_type = {}
    for c in card_list:
        by_class[c["class"]] = by_class.get(c["class"], 0) + 1
        by_type[c["type"]] = by_type.get(c["type"], 0) + 1
    print("Total unique cards:", len(card_list))
    print("By class:", by_class)
    print("By type:", by_type)
    print("Starter decks:", len(starter))
    for k, v in starter.items():
        n = sum(x["copies"] for x in v["cards"])
        print(f"  {k}: {v['name']} ({v['class']}/{v['archetype']}) — {n} cards, {len(v['cards'])} rows")


if __name__ == "__main__":
    main()
