// Card database assembly + starter deck lists.
//
// Effect DSL quick reference (interpreted by server/engine.js):
//   play / death / attack / kill / damaged / startTurn / allyDeath / allyAttack /
//   allyKill / enemyDeath / anyDeath / sacTrigger / sacrificed / rezTrigger /
//   faceDamage / ownerSpell / enemyAttack / enemyPlayed : [actions]
//   Actions carry a target selector `t` plus verbs (dmg, heal, buffA/buffH, kw,
//   draw, mana, token, rez, reclaim, copyC, bounce, destroyT, peek, flip, cond...).
//   Numeric values may be dynamic: { n, per, max, mult }.
//   `manual: true` cards log their text and are resolved by the table (DM tools).
const CLASSES = {
  commander: require('./commander'),
  dps: require('./dps'),
  wizard: require('./wizard'),
  sorcerer: require('./sorcerer'),
  crafter: require('./crafter'),
};

const BASIC_LAND = {
  id: 'land_basic', name: 'Basic Land', cls: 'neutral', arch: null, set: 'Basic',
  rarity: 'starter', cost: 0, type: 'land', text: 'Tap: add 1 mana to the shared pool',
};

const CARDS = { [BASIC_LAND.id]: BASIC_LAND };
for (const [cls, list] of Object.entries(CLASSES)) {
  for (const c of list) {
    if (CARDS[c.id]) throw new Error('Duplicate card id: ' + c.id);
    CARDS[c.id] = Object.assign({ cls }, c);
  }
}

// ---- Starter decks (exact lists from design doc v1.4) ----
// [cardId, copies]
const STARTER_DECKS = {
  commander: {
    marshal: {
      name: 'Marshal Buffs Starter', list: [
        ['land_basic', 5], ['cmd_rally', 3], ['cmd_regroup', 2], ['cmd_redirect', 3], ['cmd_inspire', 2],
        ['cmd_squire', 2], ['cmd_bannerman', 2], ['cmd_battlecry', 3], ['cmd_holdtheline', 2],
        ['cmd_banner', 2], ['cmd_formation', 2], ['cmd_warhorn', 2],
      ],
    },
    tactician: {
      name: 'Tactician Manipulation Starter', list: [
        ['land_basic', 5], ['cmd_rally', 3], ['cmd_regroup', 2], ['cmd_redirect', 3], ['cmd_inspire', 2],
        ['cmd_scout', 2], ['cmd_sergeant', 2], ['cmd_presstheattack', 3], ['cmd_scoutahead', 2],
        ['cmd_doubletime', 2], ['cmd_flank', 2], ['cmd_anticipate', 2],
      ],
    },
    warden: {
      name: 'Warden Defense Starter', list: [
        ['land_basic', 5], ['cmd_rally', 3], ['cmd_regroup', 2], ['cmd_redirect', 3], ['cmd_inspire', 2],
        ['cmd_buckler', 3], ['cmd_mend', 3], ['cmd_healingtower', 2], ['cmd_barrier', 2],
        ['cmd_shieldtower', 2], ['cmd_restoration', 2], ['cmd_bastion', 1],
      ],
    },
  },
  dps: {
    swarm: {
      name: 'Spider Swarm Starter', list: [
        ['land_basic', 5], ['dps_scrapper', 2], ['dps_brawler', 2], ['dps_zap', 2], ['dps_strike', 2], ['dps_fireball', 2],
        ['dps_hatchling', 4], ['dps_webspinner', 3], ['dps_cavespider', 3], ['dps_venomfang', 2],
        ['dps_broodmother', 2], ['dps_tunnellurker', 1],
      ],
    },
    big: {
      name: 'Ogre Big Starter', list: [
        ['land_basic', 7], ['dps_scrapper', 2], ['dps_brawler', 2], ['dps_zap', 2], ['dps_strike', 2],
        ['dps_ogrewhelp', 2], ['dps_ogrethug', 3], ['dps_ogrecrusher', 3], ['dps_ogremauler', 2],
        ['dps_ogrewarlord', 2], ['dps_ogrechieftain', 2], ['dps_cavetyrant', 1],
      ],
    },
    graveyard: {
      name: 'Undead Graveyard Starter', list: [
        ['land_basic', 5], ['dps_scrapper', 2], ['dps_brawler', 2], ['dps_zap', 2], ['dps_strike', 2], ['dps_fireball', 2],
        ['dps_skeleton', 4], ['dps_shambler', 2], ['dps_zombie', 3], ['dps_ghoul', 2],
        ['dps_gravewight', 2], ['dps_bonecolossus', 2],
      ],
    },
  },
  wizard: {
    abjurer: {
      name: 'Abjurer Denial Starter', list: [
        ['land_basic', 5], ['wiz_counter', 3], ['wiz_insight', 3], ['wiz_arcanebolt', 2], ['wiz_dispel', 2],
        ['wiz_nullify', 3], ['wiz_spellshield', 3], ['wiz_deny', 3], ['wiz_redirectspell', 2],
        ['wiz_wardingcircle', 2], ['wiz_reflect', 2],
      ],
    },
    enchanter: {
      name: 'Enchanter Buffs Starter', list: [
        ['land_basic', 5], ['wiz_counter', 3], ['wiz_insight', 3], ['wiz_arcanebolt', 2], ['wiz_dispel', 2],
        ['wiz_quicken', 3], ['wiz_sharpen', 3], ['wiz_venomtip', 2], ['wiz_lifebound', 2],
        ['wiz_fortify', 2], ['wiz_tramplehex', 2], ['wiz_dualenchant', 1],
      ],
    },
    illusionist: {
      name: 'Illusionist Cloning Starter', list: [
        ['land_basic', 5], ['wiz_counter', 3], ['wiz_insight', 3], ['wiz_arcanebolt', 2], ['wiz_dispel', 2],
        ['wiz_mirrorimage', 3], ['wiz_echo', 3], ['wiz_duplicate', 3], ['wiz_phantomdouble', 2],
        ['wiz_split', 2], ['wiz_miragearmy', 2],
      ],
    },
  },
  sorcerer: {
    necromancer: {
      name: 'Necromancer Resurrection Starter', list: [
        ['land_basic', 5], ['sor_gravepeek', 3], ['sor_soultap', 3], ['sor_darkbargain', 2], ['sor_reclaim', 2],
        ['sor_raisedead', 3], ['sor_shallowgrave', 3], ['sor_boneservant', 2], ['sor_revive', 3],
        ['sor_gravekeeper', 2], ['sor_massrevival', 2],
      ],
    },
    ritualist: {
      name: 'Ritualist Delayed Payoffs Starter', list: [
        ['land_basic', 5], ['sor_gravepeek', 3], ['sor_soultap', 3], ['sor_darkbargain', 2], ['sor_reclaim', 2],
        ['sor_bloodoffering', 3], ['sor_ritualcandle', 3], ['sor_gatheringpower', 3], ['sor_soulharvest', 2],
        ['sor_darkpact', 2], ['sor_ritualcircle', 2],
      ],
    },
    hexer: {
      name: 'Hexer Debuff Starter', list: [
        ['land_basic', 5], ['sor_gravepeek', 3], ['sor_soultap', 3], ['sor_darkbargain', 2], ['sor_reclaim', 2],
        ['sor_curse', 3], ['sor_weaken', 3], ['sor_rot', 3], ['sor_blight', 2],
        ['sor_silence', 2], ['sor_gravecurse', 2],
      ],
    },
  },
  crafter: {
    farmer: {
      name: 'Farmer Plant Creatures Starter', list: [
        ['land_basic', 5], ['cra_energyshard', 3], ['cra_harvest', 2], ['cra_minortrinket', 3], ['cra_repair', 2],
        ['cra_sprout', 3], ['cra_cornstalk', 3], ['cra_thornbush', 2], ['cra_sunflower', 3],
        ['cra_harvestgolem', 2], ['cra_ancientoak', 2],
      ],
    },
    blacksmith: {
      name: 'Blacksmith Equipment Starter', list: [
        ['land_basic', 5], ['cra_energyshard', 3], ['cra_harvest', 2], ['cra_minortrinket', 3], ['cra_repair', 2],
        ['cra_shortsword', 3], ['cra_leatherarmor', 3], ['cra_longsword', 2], ['cra_chainmail', 2],
        ['cra_spikedshield', 2], ['cra_vampiricblade', 2], ['cra_masterworkplate', 1],
      ],
    },
    alchemist: {
      name: 'Alchemist Consumables Starter', list: [
        ['land_basic', 5], ['cra_energyshard', 3], ['cra_harvest', 2], ['cra_minortrinket', 3], ['cra_repair', 2],
        ['cra_attackpotion', 3], ['cra_defenseelixir', 3], ['cra_healingpotion', 3], ['cra_hastetonic', 2],
        ['cra_giantsdraught', 2], ['cra_stoneskinoil', 2],
      ],
    },
  },
};

const CLASS_INFO = {
  commander: { color: 'White', owns: 'Coordination, turn manipulation, team buffs', role: 'Makes the team work together', archetypes: { marshal: 'Board-wide buffs, anthems, army coordination', tactician: 'Extra attacks, deck peeking, action manipulation', warden: 'Shields, heals, tower creatures' } },
  wizard: { color: 'Blue', owns: 'Spells, combos, triggers, multipliers', role: 'Combo engine backbone', archetypes: { abjurer: 'Denial, counterspells, protection', enchanter: 'Keywords, buffs, triggers', illusionist: 'Cloning, copying, multiplication' } },
  sorcerer: { color: 'Black', owns: 'Graveyard (all interaction)', role: 'Resource manipulation', archetypes: { necromancer: 'Resurrects creatures from graveyard', ritualist: 'Banks graveyard for scaling effects', hexer: 'Exiles graveyard to debuff enemies' } },
  dps: { color: 'Red', owns: 'Creatures, direct damage', role: 'Kills things', archetypes: { swarm: 'Cheap creatures, wide boards, quantity', big: 'Expensive creatures, fat stats, quality', graveyard: 'Fodder that benefits from death' } },
  crafter: { color: 'Green', owns: 'Equipment, mana ramp, artifacts', role: 'Fuels and equips the team', archetypes: { farmer: 'Plant creatures, mana generation', blacksmith: 'Equipment, permanent stat buffs', alchemist: 'Consumables, cheap burst effects' } },
};

function starterDeckList(cls, arch) {
  const d = STARTER_DECKS[cls] && STARTER_DECKS[cls][arch];
  if (!d) return null;
  const cards = [];
  for (const [id, n] of d.list) for (let i = 0; i < n; i++) cards.push(id);
  return { name: d.name, cards };
}

module.exports = { CARDS, STARTER_DECKS, CLASS_INFO, BASIC_LAND, starterDeckList };
