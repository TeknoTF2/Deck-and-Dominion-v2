// DPS — Red. Creatures, direct damage.
module.exports = [
  // ---- Class Staples ----
  { id: 'dps_scrapper', name: 'Scrapper', arch: null, set: 'Staples', rarity: 'starter', cost: 1, type: 'creature', atk: 1, hp: 1, text: 'None' },
  { id: 'dps_brawler', name: 'Brawler', arch: null, set: 'Staples', rarity: 'starter', cost: 2, type: 'creature', atk: 2, hp: 2, text: 'None' },
  { id: 'dps_zap', name: 'Zap', arch: null, set: 'Staples', rarity: 'starter', cost: 1, type: 'spell', text: 'Deal 2 damage', play: [{ t: 'any', dmg: 2 }] },
  { id: 'dps_strike', name: 'Strike', arch: null, set: 'Staples', rarity: 'starter', cost: 2, type: 'spell', text: 'Deal 4 damage', play: [{ t: 'any', dmg: 4 }] },
  { id: 'dps_fireball', name: 'Fireball', arch: null, set: 'Staples', rarity: 'starter', cost: 3, type: 'spell', text: 'Deal 6 damage', play: [{ t: 'any', dmg: 6 }] },

  // ---- SWARM: Spiders (Starter) ----
  { id: 'dps_hatchling', name: 'Hatchling', arch: 'swarm', set: 'Spiders', rarity: 'starter', cost: 1, type: 'creature', atk: 1, hp: 1, tribe: 'Spider', text: 'None' },
  { id: 'dps_webspinner', name: 'Web Spinner', arch: 'swarm', set: 'Spiders', rarity: 'starter', cost: 1, type: 'creature', atk: 1, hp: 2, tribe: 'Spider', text: 'None' },
  { id: 'dps_cavespider', name: 'Cave Spider', arch: 'swarm', set: 'Spiders', rarity: 'starter', cost: 2, type: 'creature', atk: 2, hp: 2, tribe: 'Spider', text: 'None' },
  { id: 'dps_venomfang', name: 'Venomfang', arch: 'swarm', set: 'Spiders', rarity: 'starter', cost: 2, type: 'creature', atk: 1, hp: 1, tribe: 'Spider', kw: ['poison:1'], text: 'Poison 1' },
  { id: 'dps_broodmother', name: 'Brood Mother', arch: 'swarm', set: 'Spiders', rarity: 'starter', cost: 4, type: 'creature', atk: 2, hp: 4, tribe: 'Spider', text: 'Creates 1/1 Spider at start of turn', startTurn: [{ token: { name: 'Spider', a: 1, h: 1, n: 1, tribe: 'Spider' } }] },
  { id: 'dps_tunnellurker', name: 'Tunnel Lurker', arch: 'swarm', set: 'Spiders', rarity: 'starter', cost: 3, type: 'creature', atk: 3, hp: 3, tribe: 'Spider', text: 'None' },

  // ---- SWARM: Goblins (Common) ----
  { id: 'dps_goblinrunt', name: 'Goblin Runt', arch: 'swarm', set: 'Goblins', rarity: 'common', cost: 1, type: 'creature', atk: 1, hp: 1, tribe: 'Goblin', text: 'When played, draw a card', play: [{ draw: 1 }] },
  { id: 'dps_goblinscrounger', name: 'Goblin Scrounger', arch: 'swarm', set: 'Goblins', rarity: 'common', cost: 1, type: 'creature', atk: 0, hp: 1, tribe: 'Goblin', text: 'When this dies, draw a card', death: [{ draw: 1 }] },
  { id: 'dps_goblinraider', name: 'Goblin Raider', arch: 'swarm', set: 'Goblins', rarity: 'common', cost: 1, type: 'creature', atk: 2, hp: 1, tribe: 'Goblin', text: 'None' },
  { id: 'dps_goblinlobber', name: 'Goblin Lobber', arch: 'swarm', set: 'Goblins', rarity: 'common', cost: 1, type: 'creature', atk: 1, hp: 1, tribe: 'Goblin', text: 'When played, deal 1 damage', play: [{ t: 'any', dmg: 1 }] },
  { id: 'dps_goblinhoarder', name: 'Goblin Hoarder', arch: 'swarm', set: 'Goblins', rarity: 'common', cost: 1, type: 'creature', atk: 0, hp: 2, tribe: 'Goblin', text: 'When this dies, draw a card', death: [{ draw: 1 }] },
  { id: 'dps_goblintorchbearer', name: 'Goblin Torchbearer', arch: 'swarm', set: 'Goblins', rarity: 'common', cost: 1, type: 'creature', atk: 1, hp: 1, tribe: 'Goblin', text: 'When this dies, deal 1 damage', death: [{ t: 'randomEnemy', dmg: 1 }] },
  { id: 'dps_goblinlookout', name: 'Goblin Lookout', arch: 'swarm', set: 'Goblins', rarity: 'common', cost: 2, type: 'creature', atk: 1, hp: 1, tribe: 'Goblin', text: 'When played, draw 2 cards', play: [{ draw: 2 }] },
  { id: 'dps_goblinsapper', name: 'Goblin Sapper', arch: 'swarm', set: 'Goblins', rarity: 'common', cost: 2, type: 'creature', atk: 2, hp: 1, tribe: 'Goblin', text: 'When this dies, deal 2 damage', death: [{ t: 'randomEnemy', dmg: 2 }] },
  { id: 'dps_goblinmob', name: 'Goblin Mob', arch: 'swarm', set: 'Goblins', rarity: 'common', cost: 2, type: 'creature', atk: 1, hp: 1, tribe: 'Goblin', text: 'When played, create a 1/1 Goblin token', play: [{ token: { name: 'Goblin', a: 1, h: 1, n: 1, tribe: 'Goblin' } }] },
  { id: 'dps_goblinchieftain', name: 'Goblin Chieftain', arch: 'swarm', set: 'Goblins', rarity: 'common', cost: 3, type: 'creature', atk: 2, hp: 2, tribe: 'Goblin', text: 'When another Goblin dies, draw a card', allyDeath: [{ ifTribe: 'Goblin', draw: 1 }] },

  // ---- SWARM: Ants (Uncommon) ----
  { id: 'dps_workerant', name: 'Worker Ant', arch: 'swarm', set: 'Ants', rarity: 'uncommon', cost: 1, type: 'creature', atk: 1, hp: 1, tribe: 'Ant', text: '+1 health for each other Ant you control', scaling: { h: 1, per: 'tribe:Ant', other: true } },
  { id: 'dps_scoutant', name: 'Scout Ant', arch: 'swarm', set: 'Ants', rarity: 'uncommon', cost: 1, type: 'creature', atk: 1, hp: 1, tribe: 'Ant', text: 'When played, look at top 2 cards of your deck. Keep one, discard the other', play: [{ peek: { deck: 'self', n: 2, keep: 1, discardRest: true } }] },
  { id: 'dps_soldierant', name: 'Soldier Ant', arch: 'swarm', set: 'Ants', rarity: 'uncommon', cost: 2, type: 'creature', atk: 2, hp: 2, tribe: 'Ant', text: '+1 attack for each other Ant you control', scaling: { a: 1, per: 'tribe:Ant', other: true } },
  { id: 'dps_tunnelant', name: 'Tunnel Ant', arch: 'swarm', set: 'Ants', rarity: 'uncommon', cost: 1, type: 'creature', atk: 0, hp: 2, tribe: 'Ant', text: 'At start of your turn, create a 1/1 Ant token', startTurn: [{ token: { name: 'Ant', a: 1, h: 1, n: 1, tribe: 'Ant' } }] },
  { id: 'dps_bitingant', name: 'Biting Ant', arch: 'swarm', set: 'Ants', rarity: 'uncommon', cost: 1, type: 'creature', atk: 2, hp: 1, tribe: 'Ant', text: 'None' },
  { id: 'dps_swarmcarrier', name: 'Swarm Carrier', arch: 'swarm', set: 'Ants', rarity: 'uncommon', cost: 2, type: 'creature', atk: 1, hp: 1, tribe: 'Ant', text: 'When this dies, create two 1/1 Ant tokens', death: [{ token: { name: 'Ant', a: 1, h: 1, n: 2, tribe: 'Ant' } }] },
  { id: 'dps_harvesterant', name: 'Harvester Ant', arch: 'swarm', set: 'Ants', rarity: 'uncommon', cost: 2, type: 'creature', atk: 1, hp: 3, tribe: 'Ant', text: 'When another Ant dies, add 1 mana', allyDeath: [{ ifTribe: 'Ant', mana: 1 }] },
  { id: 'dps_fireant', name: 'Fire Ant', arch: 'swarm', set: 'Ants', rarity: 'uncommon', cost: 2, type: 'creature', atk: 1, hp: 1, tribe: 'Ant', text: 'When played, deal 1 damage for each other Ant you control', play: [{ t: 'any', dmg: { n: 1, per: 'tribe:Ant', other: true } }] },
  { id: 'dps_antcolony', name: 'Ant Colony', arch: 'swarm', set: 'Ants', rarity: 'uncommon', cost: 3, type: 'tower', atk: 0, hp: 4, tribe: 'Ant', text: 'Tower. Create a 1/1 Ant token at start of your turn', startTurn: [{ token: { name: 'Ant', a: 1, h: 1, n: 1, tribe: 'Ant' } }] },
  { id: 'dps_antqueen', name: 'Ant Queen', arch: 'swarm', set: 'Ants', rarity: 'uncommon', cost: 4, type: 'creature', atk: 2, hp: 4, tribe: 'Ant', text: 'Other Ants get +1/+1', aura: { a: 1, h: 1, scope: 'tribe:Ant', other: true } },

  // ---- SWARM: Wasps (Uncommon) ----
  { id: 'dps_dronewasp', name: 'Drone Wasp', arch: 'swarm', set: 'Wasps', rarity: 'uncommon', cost: 1, type: 'creature', atk: 1, hp: 1, tribe: 'Wasp', kw: ['haste'], text: 'Haste' },
  { id: 'dps_stinger', name: 'Stinger', arch: 'swarm', set: 'Wasps', rarity: 'uncommon', cost: 1, type: 'creature', atk: 2, hp: 1, tribe: 'Wasp', text: 'None' },
  { id: 'dps_paperwasp', name: 'Paper Wasp', arch: 'swarm', set: 'Wasps', rarity: 'uncommon', cost: 2, type: 'creature', atk: 2, hp: 1, tribe: 'Wasp', kw: ['haste'], text: 'Haste' },
  { id: 'dps_muddauber', name: 'Mud Dauber', arch: 'swarm', set: 'Wasps', rarity: 'uncommon', cost: 2, type: 'creature', atk: 1, hp: 3, tribe: 'Wasp', text: 'When this attacks, deal 1 damage to another target', attack: [{ t: 'any', dmg: 1 }] },
  { id: 'dps_hornet', name: 'Hornet', arch: 'swarm', set: 'Wasps', rarity: 'uncommon', cost: 2, type: 'creature', atk: 3, hp: 1, tribe: 'Wasp', text: 'None' },
  { id: 'dps_killerwasp', name: 'Killer Wasp', arch: 'swarm', set: 'Wasps', rarity: 'uncommon', cost: 3, type: 'creature', atk: 3, hp: 1, tribe: 'Wasp', kw: ['haste'], text: 'Haste' },
  { id: 'dps_tarantulahawk', name: 'Tarantula Hawk', arch: 'swarm', set: 'Wasps', rarity: 'uncommon', cost: 3, type: 'creature', atk: 2, hp: 2, tribe: 'Wasp', text: 'When this kills a creature, draw a card', kill: [{ draw: 1 }] },
  { id: 'dps_swarmcloud', name: 'Swarm Cloud', arch: 'swarm', set: 'Wasps', rarity: 'uncommon', cost: 2, type: 'creature', atk: 1, hp: 1, tribe: 'Wasp', text: 'When played, create two 1/1 Wasp tokens', play: [{ token: { name: 'Wasp', a: 1, h: 1, n: 2, tribe: 'Wasp' } }] },
  { id: 'dps_yellowjacket', name: 'Yellowjacket', arch: 'swarm', set: 'Wasps', rarity: 'uncommon', cost: 3, type: 'creature', atk: 2, hp: 2, tribe: 'Wasp', text: 'When this attacks, all other Wasps get +1 attack this turn', attack: [{ t: 'allFriendly', filter: 'tribe:Wasp', buffA: 1, dur: 'turn', exceptSubject: true }] },
  { id: 'dps_waspnest', name: 'Wasp Nest', arch: 'swarm', set: 'Wasps', rarity: 'uncommon', cost: 3, type: 'tower', atk: 0, hp: 3, tribe: 'Wasp', text: 'Tower. Create a 1/1 Wasp token with Haste at start of your turn', startTurn: [{ token: { name: 'Wasp', a: 1, h: 1, n: 1, kw: ['haste'], tribe: 'Wasp' } }] },

  // ---- SWARM: Ooze (Rare) ----
  { id: 'dps_acidicooze', name: 'Acidic Ooze', arch: 'swarm', set: 'Ooze', rarity: 'rare', cost: 2, type: 'creature', atk: 2, hp: 2, tribe: 'Ooze', text: 'When this dies, create two 1/1 Ooze tokens', death: [{ token: { name: 'Ooze', a: 1, h: 1, n: 2, tribe: 'Ooze' } }] },
  { id: 'dps_splittinggel', name: 'Splitting Gel', arch: 'swarm', set: 'Ooze', rarity: 'rare', cost: 3, type: 'creature', atk: 3, hp: 3, tribe: 'Ooze', text: 'When this dies, create two 1/1 Ooze tokens', death: [{ token: { name: 'Ooze', a: 1, h: 1, n: 2, tribe: 'Ooze' } }] },
  { id: 'dps_corrosiveooze', name: 'Corrosive Ooze', arch: 'swarm', set: 'Ooze', rarity: 'rare', cost: 2, type: 'creature', atk: 1, hp: 2, tribe: 'Ooze', text: "When this deals damage to a creature, destroy that creature's equipment", dealtDamage: [{ destroyEquipOnVictim: true }] },
  { id: 'dps_toxicslime', name: 'Toxic Slime', arch: 'swarm', set: 'Ooze', rarity: 'rare', cost: 3, type: 'creature', atk: 2, hp: 2, tribe: 'Ooze', text: 'When this dies, create two 1/1 Ooze tokens with Poison 1', death: [{ token: { name: 'Toxic Ooze', a: 1, h: 1, n: 2, kw: ['poison:1'], tribe: 'Ooze' } }] },
  { id: 'dps_gelatinousmass', name: 'Gelatinous Mass', arch: 'swarm', set: 'Ooze', rarity: 'rare', cost: 4, type: 'creature', atk: 2, hp: 4, tribe: 'Ooze', text: 'When this takes damage and survives, create a 1/1 Ooze token', damaged: [{ ifSurvived: true, token: { name: 'Ooze', a: 1, h: 1, n: 1, tribe: 'Ooze' } }] },
  { id: 'dps_absorbingooze', name: 'Absorbing Ooze', arch: 'swarm', set: 'Ooze', rarity: 'rare', cost: 3, type: 'creature', atk: 1, hp: 3, tribe: 'Ooze', text: 'When another Ooze dies, gain +1/+1 permanently', allyDeath: [{ ifTribe: 'Ooze', t: 'self', buffA: 1, buffH: 1, dur: 'perm' }] },
  { id: 'dps_engulfingooze', name: 'Engulfing Ooze', arch: 'swarm', set: 'Ooze', rarity: 'rare', cost: 4, type: 'creature', atk: 3, hp: 3, tribe: 'Ooze', text: "When this kills a creature, gain health equal to that creature's health", manual: true },
  { id: 'dps_mitosis', name: 'Mitosis', arch: 'swarm', set: 'Ooze', rarity: 'rare', cost: 2, type: 'spell', text: 'Target Ooze splits into two copies with half stats (rounded up)', play: [{ t: 'friendly', filter: 'tribe:Ooze', split: { round: 'up' } }] },
  { id: 'dps_dissolve', name: 'Dissolve', arch: 'swarm', set: 'Ooze', rarity: 'rare', cost: 3, type: 'spell', text: 'Deal damage to target creature equal to the number of Ooze creatures you control', play: [{ t: 'creature', dmg: { n: 1, per: 'tribe:Ooze' } }] },
  { id: 'dps_primordialooze', name: 'Primordial Ooze', arch: 'swarm', set: 'Ooze', rarity: 'rare', cost: 5, type: 'creature', atk: 4, hp: 4, tribe: 'Ooze', text: 'When this dies, create two copies with half stats. Those copies also split on death', death: [{ token: { name: 'Primordial Ooze Half', a: 2, h: 2, n: 2, tribe: 'Ooze', splitsOnDeath: true } }] },

  // ---- SWARM: Locust (Legendary) ----
  { id: 'dps_locustswarm', name: 'Locust Swarm', arch: 'swarm', set: 'Locust', rarity: 'legendary', cost: 6, type: 'creature', atk: 4, hp: 4, tribe: 'Locust', text: 'When this attacks, destroy target land, equipment, persistent, or tower. Creates a 1/1 Locust token for each card destroyed this way', attack: [{ destroyT: { filter: 'land,equip,persistent,tower' }, tokenPerDestroyed: { name: 'Locust', a: 1, h: 1, tribe: 'Locust' } }] },
  { id: 'dps_plagueoflocusts', name: 'Plague of Locusts', arch: 'swarm', set: 'Locust', rarity: 'legendary', cost: 5, type: 'spell', text: 'Destroy up to 3 target lands, equipment, persistents, or towers. For each destroyed, create a 1/1 Locust token', play: [{ destroyT: { filter: 'land,equip,persistent,tower', n: 3, upTo: true }, tokenPerDestroyed: { name: 'Locust', a: 1, h: 1, tribe: 'Locust' } }] },

  // ---- BIG: Ogres (Starter) ----
  { id: 'dps_ogrewhelp', name: 'Ogre Whelp', arch: 'big', set: 'Ogres', rarity: 'starter', cost: 2, type: 'creature', atk: 2, hp: 3, tribe: 'Ogre', text: 'None' },
  { id: 'dps_ogrethug', name: 'Ogre Thug', arch: 'big', set: 'Ogres', rarity: 'starter', cost: 3, type: 'creature', atk: 3, hp: 4, tribe: 'Ogre', text: 'None' },
  { id: 'dps_ogrecrusher', name: 'Ogre Crusher', arch: 'big', set: 'Ogres', rarity: 'starter', cost: 4, type: 'creature', atk: 4, hp: 5, tribe: 'Ogre', text: 'None' },
  { id: 'dps_ogremauler', name: 'Ogre Mauler', arch: 'big', set: 'Ogres', rarity: 'starter', cost: 4, type: 'creature', atk: 5, hp: 4, tribe: 'Ogre', text: 'None' },
  { id: 'dps_ogrewarlord', name: 'Ogre Warlord', arch: 'big', set: 'Ogres', rarity: 'starter', cost: 5, type: 'creature', atk: 6, hp: 6, tribe: 'Ogre', text: 'None' },
  { id: 'dps_ogrechieftain', name: 'Ogre Chieftain', arch: 'big', set: 'Ogres', rarity: 'starter', cost: 6, type: 'creature', atk: 6, hp: 6, tribe: 'Ogre', text: '+1 attack per friendly creature that costs less', scaling: { a: 1, per: 'cheaperFriendly' } },
  { id: 'dps_cavetyrant', name: 'Cave Tyrant', arch: 'big', set: 'Ogres', rarity: 'starter', cost: 7, type: 'creature', atk: 6, hp: 6, tribe: 'Ogre', text: '+1/+1 per two creatures it kills (permanent)', kill: [{ everyN: 2, t: 'self', buffA: 1, buffH: 1, dur: 'perm' }] },

  // ---- BIG: Bears (Common) ----
  { id: 'dps_bearcub', name: 'Bear Cub', arch: 'big', set: 'Bears', rarity: 'common', cost: 2, type: 'creature', atk: 1, hp: 3, tribe: 'Bear', text: 'None' },
  { id: 'dps_blackbear', name: 'Black Bear', arch: 'big', set: 'Bears', rarity: 'common', cost: 3, type: 'creature', atk: 2, hp: 4, tribe: 'Bear', text: 'None' },
  { id: 'dps_cavebear', name: 'Cave Bear', arch: 'big', set: 'Bears', rarity: 'common', cost: 3, type: 'creature', atk: 3, hp: 3, tribe: 'Bear', text: 'None' },
  { id: 'dps_grizzly', name: 'Grizzly', arch: 'big', set: 'Bears', rarity: 'common', cost: 4, type: 'creature', atk: 3, hp: 5, tribe: 'Bear', text: 'None' },
  { id: 'dps_honeybear', name: 'Honey Bear', arch: 'big', set: 'Bears', rarity: 'common', cost: 3, type: 'creature', atk: 2, hp: 3, tribe: 'Bear', text: 'Restore 2 player HP when played', play: [{ heal: 2 }] },
  { id: 'dps_territorialbear', name: 'Territorial Bear', arch: 'big', set: 'Bears', rarity: 'common', cost: 3, type: 'creature', atk: 2, hp: 4, tribe: 'Bear', kw: ['taunt'], text: 'Taunt' },
  { id: 'dps_maulingbear', name: 'Mauling Bear', arch: 'big', set: 'Bears', rarity: 'common', cost: 4, type: 'creature', atk: 4, hp: 4, tribe: 'Bear', kw: ['trample'], text: 'Trample' },
  { id: 'dps_motherbear', name: 'Mother Bear', arch: 'big', set: 'Bears', rarity: 'common', cost: 4, type: 'creature', atk: 3, hp: 5, tribe: 'Bear', text: 'When another Bear dies, +2 attack until end of turn', allyDeath: [{ ifTribe: 'Bear', t: 'self', buffA: 2, dur: 'turn' }] },
  { id: 'dps_hibernatingbear', name: 'Hibernating Bear', arch: 'big', set: 'Bears', rarity: 'common', cost: 4, type: 'creature', atk: 0, hp: 6, tribe: 'Bear', text: 'Gains +4 attack on your turn only', manualNote: '+4 attack during its controller\'s turn' },
  { id: 'dps_alphabear', name: 'Alpha Bear', arch: 'big', set: 'Bears', rarity: 'common', cost: 5, type: 'creature', atk: 4, hp: 6, tribe: 'Bear', text: 'Other Bears get +1 health', aura: { h: 1, scope: 'tribe:Bear', other: true } },

  // ---- BIG: Golems (Uncommon) ----
  { id: 'dps_claygolem', name: 'Clay Golem', arch: 'big', set: 'Golems', rarity: 'uncommon', cost: 3, type: 'creature', atk: 2, hp: 4, tribe: 'Golem', text: 'None' },
  { id: 'dps_stonegolem', name: 'Stone Golem', arch: 'big', set: 'Golems', rarity: 'uncommon', cost: 4, type: 'creature', atk: 3, hp: 5, tribe: 'Golem', text: 'None' },
  { id: 'dps_irongolem', name: 'Iron Golem', arch: 'big', set: 'Golems', rarity: 'uncommon', cost: 5, type: 'creature', atk: 4, hp: 6, tribe: 'Golem', text: 'None' },
  { id: 'dps_obsidiangolem', name: 'Obsidian Golem', arch: 'big', set: 'Golems', rarity: 'uncommon', cost: 4, type: 'creature', atk: 4, hp: 3, tribe: 'Golem', kw: ['shield:3'], text: 'Shield 3' },
  { id: 'dps_granitesentinel', name: 'Granite Sentinel', arch: 'big', set: 'Golems', rarity: 'uncommon', cost: 3, type: 'creature', atk: 1, hp: 5, tribe: 'Golem', kw: ['taunt'], text: 'Taunt' },
  { id: 'dps_magmagolem', name: 'Magma Golem', arch: 'big', set: 'Golems', rarity: 'uncommon', cost: 5, type: 'creature', atk: 5, hp: 4, tribe: 'Golem', kw: ['trample'], text: 'Trample' },
  { id: 'dps_mendinggolem', name: 'Mending Golem', arch: 'big', set: 'Golems', rarity: 'uncommon', cost: 4, type: 'creature', atk: 3, hp: 4, tribe: 'Golem', text: 'Restore 2 health to itself at start of your turn', startTurn: [{ t: 'self', healC: 2 }] },
  { id: 'dps_runicgolem', name: 'Runic Golem', arch: 'big', set: 'Golems', rarity: 'uncommon', cost: 5, type: 'creature', atk: 3, hp: 5, tribe: 'Golem', kw: ['nospell'], text: 'Cannot be targeted by spells' },
  { id: 'dps_siegegolem', name: 'Siege Golem', arch: 'big', set: 'Golems', rarity: 'uncommon', cost: 6, type: 'creature', atk: 5, hp: 6, tribe: 'Golem', text: 'Deals double damage to Towers and Persistents', doubleVsTower: true },
  { id: 'dps_colossus', name: 'Colossus', arch: 'big', set: 'Golems', rarity: 'uncommon', cost: 7, type: 'creature', atk: 7, hp: 7, tribe: 'Golem', kw: ['shield:4'], text: 'Shield 4' },

  // ---- BIG: Wurms (Uncommon) ----
  { id: 'dps_tunnelwurm', name: 'Tunnel Wurm', arch: 'big', set: 'Wurms', rarity: 'uncommon', cost: 4, type: 'creature', atk: 4, hp: 4, tribe: 'Wurm', text: 'None' },
  { id: 'dps_burrowingwurm', name: 'Burrowing Wurm', arch: 'big', set: 'Wurms', rarity: 'uncommon', cost: 4, type: 'creature', atk: 5, hp: 3, tribe: 'Wurm', kw: ['trample'], text: 'Trample' },
  { id: 'dps_sandwurm', name: 'Sand Wurm', arch: 'big', set: 'Wurms', rarity: 'uncommon', cost: 5, type: 'creature', atk: 5, hp: 5, tribe: 'Wurm', text: 'None' },
  { id: 'dps_rockwurm', name: 'Rock Wurm', arch: 'big', set: 'Wurms', rarity: 'uncommon', cost: 5, type: 'creature', atk: 4, hp: 6, tribe: 'Wurm', text: 'None' },
  { id: 'dps_razormawwurm', name: 'Razormaw Wurm', arch: 'big', set: 'Wurms', rarity: 'uncommon', cost: 5, type: 'creature', atk: 6, hp: 4, tribe: 'Wurm', kw: ['trample'], text: 'Trample' },
  { id: 'dps_ambushwurm', name: 'Ambush Wurm', arch: 'big', set: 'Wurms', rarity: 'uncommon', cost: 4, type: 'creature', atk: 4, hp: 3, tribe: 'Wurm', kw: ['haste'], text: 'Haste' },
  { id: 'dps_devouringwurm', name: 'Devouring Wurm', arch: 'big', set: 'Wurms', rarity: 'uncommon', cost: 6, type: 'creature', atk: 5, hp: 5, tribe: 'Wurm', text: 'When this kills a creature, gain +2 health', kill: [{ t: 'self', buffH: 2, dur: 'perm' }] },
  { id: 'dps_tremorwurm', name: 'Tremor Wurm', arch: 'big', set: 'Wurms', rarity: 'uncommon', cost: 6, type: 'creature', atk: 4, hp: 5, tribe: 'Wurm', text: 'When played, deal 2 damage to all enemy creatures', play: [{ t: 'allEnemy', dmg: 2 }] },
  { id: 'dps_greatwurm', name: 'Great Wurm', arch: 'big', set: 'Wurms', rarity: 'uncommon', cost: 7, type: 'creature', atk: 7, hp: 7, tribe: 'Wurm', kw: ['trample'], text: 'Trample' },
  { id: 'dps_elderwurm', name: 'Elder Wurm', arch: 'big', set: 'Wurms', rarity: 'uncommon', cost: 8, type: 'creature', atk: 8, hp: 8, tribe: 'Wurm', kw: ['trample'], text: 'Trample. When this attacks, deal 1 damage to all enemy creatures', attack: [{ t: 'allEnemy', dmg: 1 }] },

  // ---- BIG: Kaiju (Rare) ----
  { id: 'dps_titanbeetle', name: 'Titan Beetle', arch: 'big', set: 'Kaiju', rarity: 'rare', cost: 6, type: 'creature', atk: 7, hp: 7, tribe: 'Kaiju', kw: ['trample'], text: 'Trample' },
  { id: 'dps_leviathan', name: 'Leviathan', arch: 'big', set: 'Kaiju', rarity: 'rare', cost: 7, type: 'creature', atk: 8, hp: 8, tribe: 'Kaiju', text: 'None' },
  { id: 'dps_thunderjaw', name: 'Thunderjaw', arch: 'big', set: 'Kaiju', rarity: 'rare', cost: 7, type: 'creature', atk: 7, hp: 6, tribe: 'Kaiju', kw: ['trample'], text: 'Trample. When played, deal 3 damage to all enemy creatures', play: [{ t: 'allEnemy', dmg: 3 }] },
  { id: 'dps_behemoth', name: 'Behemoth', arch: 'big', set: 'Kaiju', rarity: 'rare', cost: 8, type: 'creature', atk: 9, hp: 9, tribe: 'Kaiju', kw: ['taunt'], text: 'Taunt' },
  { id: 'dps_apexpredator', name: 'Apex Predator', arch: 'big', set: 'Kaiju', rarity: 'rare', cost: 7, type: 'creature', atk: 8, hp: 5, tribe: 'Kaiju', kw: ['firststrike', 'trample'], text: 'First Strike. Trample' },
  { id: 'dps_colossalcrab', name: 'Colossal Crab', arch: 'big', set: 'Kaiju', rarity: 'rare', cost: 6, type: 'creature', atk: 4, hp: 10, tribe: 'Kaiju', kw: ['taunt', 'shield:3'], text: 'Taunt. Shield 3' },
  { id: 'dps_worldbreaker', name: 'Worldbreaker', arch: 'big', set: 'Kaiju', rarity: 'rare', cost: 8, type: 'creature', atk: 8, hp: 7, tribe: 'Kaiju', kw: ['trample'], text: 'Trample. When this attacks, deal 2 damage to all enemy creatures', attack: [{ t: 'allEnemy', dmg: 2 }] },
  { id: 'dps_megafauna', name: 'Megafauna', arch: 'big', set: 'Kaiju', rarity: 'rare', cost: 6, type: 'creature', atk: 6, hp: 8, tribe: 'Kaiju', kw: ['nospell'], text: 'Cannot be destroyed by spells. Can only be killed by combat damage', manualNote: 'Spell damage does not destroy it' },
  { id: 'dps_rampage', name: 'Rampage', arch: 'big', set: 'Kaiju', rarity: 'rare', cost: 4, type: 'spell', text: 'Target creature with 5+ attack deals its attack damage to all enemy creatures', play: [{ t: 'friendly', filter: 'atkMin:5', dmgAllEnemyFromAtk: true }] },
  { id: 'dps_extinctionevent', name: 'Extinction Event', arch: 'big', set: 'Kaiju', rarity: 'rare', cost: 6, type: 'spell', text: 'Deal 5 damage to all creatures. Your creatures with 7+ health survive with 1 health instead', play: [{ t: 'allCreatures', dmg: 5, surviveIfHpMin: 7 }] },

  // ---- BIG: Dragon (Legendary) ----
  { id: 'dps_ancientdragon', name: 'Ancient Dragon', arch: 'big', set: 'Dragon', rarity: 'legendary', cost: 9, type: 'creature', atk: 10, hp: 10, tribe: 'Dragon', kw: ['trample', 'firststrike'], text: 'Trample. First Strike. When played, deal 5 damage to all enemy creatures', play: [{ t: 'allEnemy', dmg: 5 }] },
  { id: 'dps_dragonsfury', name: "Dragon's Fury", arch: 'big', set: 'Dragon', rarity: 'legendary', cost: 7, type: 'spell', text: "Deal damage to all enemy creatures equal to your strongest creature's attack", play: [{ t: 'allEnemy', dmg: { per: 'maxFriendlyAtk' } }] },

  // ---- UNDEAD: Skeletons (Starter) ----
  { id: 'dps_skeleton', name: 'Skeleton', arch: 'graveyard', set: 'Skeletons', rarity: 'starter', cost: 1, type: 'creature', atk: 1, hp: 1, tribe: 'Skeleton', text: 'None' },
  { id: 'dps_shambler', name: 'Shambler', arch: 'graveyard', set: 'Skeletons', rarity: 'starter', cost: 1, type: 'creature', atk: 0, hp: 2, tribe: 'Skeleton', text: 'None' },
  { id: 'dps_zombie', name: 'Zombie', arch: 'graveyard', set: 'Skeletons', rarity: 'starter', cost: 2, type: 'creature', atk: 2, hp: 2, tribe: 'Zombie', text: 'None' },
  { id: 'dps_ghoul', name: 'Ghoul', arch: 'graveyard', set: 'Skeletons', rarity: 'starter', cost: 2, type: 'creature', atk: 2, hp: 1, tribe: 'Zombie', text: 'None' },
  { id: 'dps_gravewight', name: 'Grave Wight', arch: 'graveyard', set: 'Skeletons', rarity: 'starter', cost: 3, type: 'creature', atk: 2, hp: 2, tribe: 'Skeleton', text: '+1 attack per 3 creatures in graveyard', scaling: { a: 1, per: 'graveCreatures:3' } },
  { id: 'dps_bonecolossus', name: 'Bone Colossus', arch: 'graveyard', set: 'Skeletons', rarity: 'starter', cost: 5, type: 'creature', atk: 3, hp: 5, tribe: 'Skeleton', text: '+1/+1 per 5 creatures in graveyard', scaling: { a: 1, h: 1, per: 'graveCreatures:5' } },

  // ---- UNDEAD: Zombies (Common) ----
  { id: 'dps_shamblingcorpse', name: 'Shambling Corpse', arch: 'graveyard', set: 'Zombies', rarity: 'common', cost: 1, type: 'creature', atk: 1, hp: 2, tribe: 'Zombie', text: 'None' },
  { id: 'dps_crawlingdead', name: 'Crawling Dead', arch: 'graveyard', set: 'Zombies', rarity: 'common', cost: 1, type: 'creature', atk: 0, hp: 3, tribe: 'Zombie', text: 'None' },
  { id: 'dps_rottingzombie', name: 'Rotting Zombie', arch: 'graveyard', set: 'Zombies', rarity: 'common', cost: 2, type: 'creature', atk: 2, hp: 2, tribe: 'Zombie', text: 'None' },
  { id: 'dps_plaguebearer', name: 'Plaguebearer', arch: 'graveyard', set: 'Zombies', rarity: 'common', cost: 2, type: 'creature', atk: 1, hp: 2, tribe: 'Zombie', kw: ['poison:1'], text: 'Poison 1' },
  { id: 'dps_undyingservant', name: 'Undying Servant', arch: 'graveyard', set: 'Zombies', rarity: 'common', cost: 2, type: 'creature', atk: 1, hp: 2, tribe: 'Zombie', text: 'When this dies, return it to your hand', returnHandOnDeath: true },
  { id: 'dps_bloatedzombie', name: 'Bloated Zombie', arch: 'graveyard', set: 'Zombies', rarity: 'common', cost: 3, type: 'creature', atk: 2, hp: 4, tribe: 'Zombie', text: 'When this dies, deal 2 damage to all enemy creatures', death: [{ t: 'allEnemy', dmg: 2 }] },
  { id: 'dps_relentlessdead', name: 'Relentless Dead', arch: 'graveyard', set: 'Zombies', rarity: 'common', cost: 3, type: 'creature', atk: 2, hp: 3, tribe: 'Zombie', text: 'When this dies, return a random Zombie from graveyard to your hand', death: [{ reclaim: { n: 1, tribe: 'Zombie', random: true } }] },
  { id: 'dps_graveshambler', name: 'Grave Shambler', arch: 'graveyard', set: 'Zombies', rarity: 'common', cost: 3, type: 'creature', atk: 3, hp: 3, tribe: 'Zombie', text: 'None' },
  { id: 'dps_fleshgolem', name: 'Flesh Golem', arch: 'graveyard', set: 'Zombies', rarity: 'common', cost: 4, type: 'creature', atk: 3, hp: 5, tribe: 'Zombie', text: 'When another Zombie dies, gain +1 health', allyDeath: [{ ifTribe: 'Zombie', t: 'self', buffH: 1, dur: 'perm' }] },
  { id: 'dps_zombiehorde', name: 'Zombie Horde', arch: 'graveyard', set: 'Zombies', rarity: 'common', cost: 4, type: 'creature', atk: 2, hp: 3, tribe: 'Zombie', text: 'When this attacks, create a 1/1 Zombie token', attack: [{ token: { name: 'Zombie', a: 1, h: 1, n: 1, tribe: 'Zombie' } }] },

  // ---- UNDEAD: Ghosts (Uncommon) ----
  { id: 'dps_wisp', name: 'Wisp', arch: 'graveyard', set: 'Ghosts', rarity: 'uncommon', cost: 1, type: 'creature', atk: 1, hp: 1, tribe: 'Ghost', text: "When this dies, look at top 3 cards of DM's graveyard", death: [{ peek: { deck: 'dmgrave', n: 3 } }] },
  { id: 'dps_specter', name: 'Specter', arch: 'graveyard', set: 'Ghosts', rarity: 'uncommon', cost: 2, type: 'creature', atk: 1, hp: 2, tribe: 'Ghost', text: "When this dies, exile a creature from DM's graveyard", death: [{ exileFromGrave: { side: 'dm', type: 'creature', n: 1 } }] },
  { id: 'dps_hauntingshade', name: 'Haunting Shade', arch: 'graveyard', set: 'Ghosts', rarity: 'uncommon', cost: 2, type: 'creature', atk: 2, hp: 1, tribe: 'Ghost', kw: ['noattack'], text: 'Cannot be targeted by creature attacks. Can only be killed by spells' },
  { id: 'dps_wailingghost', name: 'Wailing Ghost', arch: 'graveyard', set: 'Ghosts', rarity: 'uncommon', cost: 2, type: 'creature', atk: 1, hp: 1, tribe: 'Ghost', text: 'When played, target enemy creature gets -1 attack for 3 rounds', play: [{ t: 'enemy', buffA: -1, dur: 3 }] },
  { id: 'dps_poltergeist', name: 'Poltergeist', arch: 'graveyard', set: 'Ghosts', rarity: 'uncommon', cost: 3, type: 'creature', atk: 2, hp: 2, tribe: 'Ghost', text: 'When played, destroy target equipment on an enemy creature', play: [{ t: 'enemy', destroyEquipOnVictim: true }] },
  { id: 'dps_phantom', name: 'Phantom', arch: 'graveyard', set: 'Ghosts', rarity: 'uncommon', cost: 3, type: 'creature', atk: 0, hp: 1, tribe: 'Ghost', text: 'When played, take control of a creature cost 3 or less from DM\'s graveyard. When Phantom dies, exile both', manual: true },
  { id: 'dps_banshee', name: 'Banshee', arch: 'graveyard', set: 'Ghosts', rarity: 'uncommon', cost: 3, type: 'creature', atk: 1, hp: 3, tribe: 'Ghost', text: 'When played, deal 1 damage to all enemy creatures', play: [{ t: 'allEnemy', dmg: 1 }] },
  { id: 'dps_wraith', name: 'Wraith', arch: 'graveyard', set: 'Ghosts', rarity: 'uncommon', cost: 4, type: 'creature', atk: 3, hp: 2, tribe: 'Ghost', kw: ['noattack'], text: 'Cannot be targeted by creature attacks. Can only be killed by spells' },
  { id: 'dps_possession', name: 'Possession', arch: 'graveyard', set: 'Ghosts', rarity: 'uncommon', cost: 4, type: 'spell', text: "Take control of a creature cost 4 or less from DM's graveyard. Exile it at end of turn", play: [{ rez: { max: 4, n: 1, fromSide: 'dm', temp: true, exileAfter: true } }] },
  { id: 'dps_revenant', name: 'Revenant', arch: 'graveyard', set: 'Ghosts', rarity: 'uncommon', cost: 5, type: 'creature', atk: 0, hp: 1, tribe: 'Ghost', text: "When played, take control of a creature cost 5 or less from DM's graveyard. When Revenant dies, exile both", manual: true },

  // ---- UNDEAD: Vampires (Uncommon) ----
  { id: 'dps_vampirethrall', name: 'Vampire Thrall', arch: 'graveyard', set: 'Vampires', rarity: 'uncommon', cost: 2, type: 'creature', atk: 2, hp: 1, tribe: 'Vampire', kw: ['lifelink'], text: 'Lifelink' },
  { id: 'dps_nightstalker', name: 'Nightstalker', arch: 'graveyard', set: 'Vampires', rarity: 'uncommon', cost: 2, type: 'creature', atk: 1, hp: 2, tribe: 'Vampire', kw: ['lifelink'], text: 'Lifelink' },
  { id: 'dps_vampirerogue', name: 'Vampire Rogue', arch: 'graveyard', set: 'Vampires', rarity: 'uncommon', cost: 2, type: 'creature', atk: 2, hp: 2, tribe: 'Vampire', kw: ['lifelink'], text: 'Lifelink. When this deals damage to DM HP, draw a card', faceDamage: [{ draw: 1 }] },
  { id: 'dps_blooddrinker', name: 'Blood Drinker', arch: 'graveyard', set: 'Vampires', rarity: 'uncommon', cost: 3, type: 'creature', atk: 2, hp: 3, tribe: 'Vampire', kw: ['lifelink'], text: 'Lifelink' },
  { id: 'dps_vampireknight', name: 'Vampire Knight', arch: 'graveyard', set: 'Vampires', rarity: 'uncommon', cost: 3, type: 'creature', atk: 3, hp: 2, tribe: 'Vampire', kw: ['lifelink', 'firststrike'], text: 'Lifelink. First Strike' },
  { id: 'dps_sanguinebat', name: 'Sanguine Bat', arch: 'graveyard', set: 'Vampires', rarity: 'uncommon', cost: 1, type: 'creature', atk: 1, hp: 1, tribe: 'Vampire', kw: ['lifelink'], text: 'Lifelink' },
  { id: 'dps_bloodfrenzyv', name: 'Blood Frenzy', arch: 'graveyard', set: 'Vampires', rarity: 'uncommon', cost: 2, type: 'spell', text: 'Target creature with Lifelink gets +3 attack this turn', play: [{ t: 'creature', filter: 'kw:lifelink', buffA: 3, dur: 'turn' }] },
  { id: 'dps_crimsonfeast', name: 'Crimson Feast', arch: 'graveyard', set: 'Vampires', rarity: 'uncommon', cost: 3, type: 'spell', text: 'All your creatures with Lifelink get +2 attack this turn', play: [{ t: 'allFriendly', filter: 'kw:lifelink', buffA: 2, dur: 'turn' }] },
  { id: 'dps_vampirelord', name: 'Vampire Lord', arch: 'graveyard', set: 'Vampires', rarity: 'uncommon', cost: 4, type: 'creature', atk: 3, hp: 4, tribe: 'Vampire', kw: ['lifelink'], text: 'Lifelink. Other creatures with Lifelink get +1 attack', aura: { a: 1, scope: 'kw:lifelink', other: true } },
  { id: 'dps_eldervampire', name: 'Elder Vampire', arch: 'graveyard', set: 'Vampires', rarity: 'uncommon', cost: 5, type: 'creature', atk: 4, hp: 5, tribe: 'Vampire', kw: ['lifelink'], text: 'Lifelink. When this deals damage, gain that much attack until end of turn', manual: true },

  // ---- UNDEAD: Death Knights (Rare) ----
  { id: 'dps_dksquire', name: 'Death Knight Squire', arch: 'graveyard', set: 'Death Knight', rarity: 'rare', cost: 3, type: 'creature', atk: 2, hp: 3, tribe: 'Death Knight', holds: 2, text: 'Can hold 2 equipment' },
  { id: 'dps_dkvanguard', name: 'Death Knight Vanguard', arch: 'graveyard', set: 'Death Knight', rarity: 'rare', cost: 4, type: 'creature', atk: 3, hp: 4, tribe: 'Death Knight', holds: 2, text: 'Can hold 2 equipment' },
  { id: 'dps_dkchampion', name: 'Death Knight Champion', arch: 'graveyard', set: 'Death Knight', rarity: 'rare', cost: 5, type: 'creature', atk: 4, hp: 4, tribe: 'Death Knight', holds: 2, equipAtkDouble: true, text: 'Can hold 2 equipment. Equipment on this creature grants double its attack bonus' },
  { id: 'dps_dkcommander', name: 'Death Knight Commander', arch: 'graveyard', set: 'Death Knight', rarity: 'rare', cost: 6, type: 'creature', atk: 4, hp: 5, tribe: 'Death Knight', holds: 3, text: 'Can hold 3 equipment' },
  { id: 'dps_dkrider', name: 'Death Knight Rider', arch: 'graveyard', set: 'Death Knight', rarity: 'rare', cost: 4, type: 'creature', atk: 3, hp: 3, tribe: 'Death Knight', holds: 2, kw: ['haste'], text: 'Can hold 2 equipment. Haste' },
  { id: 'dps_dksentinel', name: 'Death Knight Sentinel', arch: 'graveyard', set: 'Death Knight', rarity: 'rare', cost: 5, type: 'creature', atk: 3, hp: 6, tribe: 'Death Knight', holds: 2, kw: ['taunt'], text: 'Can hold 2 equipment. Taunt' },
  { id: 'dps_dkexecutioner', name: 'Death Knight Executioner', arch: 'graveyard', set: 'Death Knight', rarity: 'rare', cost: 5, type: 'creature', atk: 4, hp: 4, tribe: 'Death Knight', holds: 2, kw: ['firststrike'], text: 'Can hold 2 equipment. First Strike' },
  { id: 'dps_dkwarlord', name: 'Death Knight Warlord', arch: 'graveyard', set: 'Death Knight', rarity: 'rare', cost: 7, type: 'creature', atk: 5, hp: 6, tribe: 'Death Knight', holds: 3, text: 'Can hold 3 equipment. Other Death Knights can hold 1 additional equipment', holdsAura: { scope: 'tribe:Death Knight', bonus: 1 } },
  { id: 'dps_rallythefallen', name: 'Rally the Fallen', arch: 'graveyard', set: 'Death Knight', rarity: 'rare', cost: 3, type: 'spell', text: 'All Death Knights get +2 attack this turn', play: [{ t: 'allFriendly', filter: 'tribe:Death Knight', buffA: 2, dur: 'turn' }] },
  { id: 'dps_undyingoath', name: 'Undying Oath', arch: 'graveyard', set: 'Death Knight', rarity: 'rare', cost: 2, type: 'spell', text: 'Target Death Knight gains: When this dies, its equipment returns to your hand instead of being destroyed', manual: true },

  // ---- UNDEAD: Lich (Legendary) ----
  { id: 'dps_lichking', name: 'The Lich King', arch: 'graveyard', set: 'Lich', rarity: 'legendary', cost: 8, type: 'creature', atk: 5, hp: 5, tribe: 'Lich', text: 'When a creature dies anywhere, gain +1/+1. When this would die, you may exile 10 creatures from the graveyard to return it to play with 1 health instead', anyDeath: [{ t: 'self', buffA: 1, buffH: 1, dur: 'perm' }], manualNote: 'Death-defiance (exile 10 creatures) is resolved manually' },
  { id: 'dps_commandundead', name: 'Command Undead', arch: 'graveyard', set: 'Lich', rarity: 'legendary', cost: 6, type: 'spell', text: "Take control of all creatures in the DM's graveyard with cost 3 or less. Exile them at end of turn", play: [{ rez: { max: 3, n: 99, fromSide: 'dm', temp: true, exileAfter: true } }] },
];
