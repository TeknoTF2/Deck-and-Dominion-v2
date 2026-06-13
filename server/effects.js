// effects.js — best-effort interpreter that turns a card's effect text into
// structured operations and applies them to the game. Common phrasings are
// automated; anything unrecognised is flagged for DM manual resolution
// (the design's exception-based intervention model).

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
function num(w) {
  if (w == null) return 1;
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  return NUM[String(w).toLowerCase()] ?? 1;
}

const KEYWORDS = ['Haste', 'Trample', 'Deathtouch', 'Lifelink', 'First Strike', 'Taunt'];

// Parse effect text into a list of ops + metadata. Pure function.
export function analyze(card) {
  const text = (card.text || '').trim();
  const low = text.toLowerCase();
  const ops = [];
  let needsTarget = false;
  let targetKind = 'any'; // 'enemy' | 'friendly' | 'any' | 'creature'

  const durationOf = (s) => (/permanent/.test(s) ? 'permanent' : 'turn');

  // --- Damage ---
  let m;
  if ((m = low.match(/deal (\d+) damage to all enemy creatures/))) {
    ops.push({ op: 'damage', amount: +m[1], scope: 'allEnemies' });
  } else if ((m = low.match(/deal (\d+) damage to all (?:friendly )?creatures/))) {
    ops.push({ op: 'damage', amount: +m[1], scope: 'allCreatures' });
  } else if ((m = low.match(/deal (\d+) damage to (?:dm hp|the dm|dm)/))) {
    ops.push({ op: 'damage', amount: +m[1], scope: 'dmFace' });
  } else if ((m = low.match(/deal (\d+) damage/)) && card.type === 'spell') {
    // generic targeted burn (Zap/Strike/Fireball/Arcane Bolt)
    ops.push({ op: 'damage', amount: +m[1], scope: 'target' });
    needsTarget = true; targetKind = 'any';
  }

  // --- Draw ---
  if ((m = low.match(/draw (\d+) cards?/))) ops.push({ op: 'draw', amount: +m[1] });
  else if (/draw a card/.test(low)) ops.push({ op: 'draw', amount: 1 });

  // --- Mana ---
  if ((m = low.match(/add (\d+) mana/))) {
    const burst = card.type !== 'land'; // spell mana is burst per design
    ops.push({ op: 'mana', amount: +m[1], burst });
  }

  // --- Party HP heal ---
  if ((m = low.match(/restore (\d+) player hp/))) ops.push({ op: 'healHP', amount: +m[1] });

  // --- Party shield ---
  if ((m = low.match(/(?:create|gain) (\d+) player shield/))) ops.push({ op: 'shieldHP', amount: +m[1] });

  // --- Creature heal ---
  if ((m = low.match(/restore (\d+) health to target creature/))) {
    ops.push({ op: 'healCreature', amount: +m[1], scope: 'target' });
    needsTarget = true; targetKind = 'friendly';
  }

  // --- Stat buffs ---
  if ((m = low.match(/(?:gets|get) \+(\d+)\/\+(\d+)/))) {
    const scope = /all friendly creatures/.test(low) ? 'allFriendly' : 'target';
    ops.push({ op: 'buff', attack: +m[1], health: +m[2], scope, duration: durationOf(low) });
    if (scope === 'target') { needsTarget = true; targetKind = 'friendly'; }
  } else {
    if ((m = low.match(/(?:gets|get|gains) \+(\d+) attack/))) {
      const scope = /all friendly creatures/.test(low) ? 'allFriendly' : 'target';
      ops.push({ op: 'buff', attack: +m[1], health: 0, scope, duration: durationOf(low) });
      if (scope === 'target') { needsTarget = true; targetKind = 'friendly'; }
    }
    if ((m = low.match(/(?:gets|get|gains) \+(\d+) health/))) {
      const scope = /all friendly creatures/.test(low) ? 'allFriendly' : 'target';
      ops.push({ op: 'buff', attack: 0, health: +m[1], scope, duration: durationOf(low) });
      if (scope === 'target') { needsTarget = true; targetKind = 'friendly'; }
    }
  }

  // --- Debuffs ---
  if ((m = low.match(/(?:gets|get) -(\d+)\/-(\d+)/))) {
    const scope = /all enemy creatures/.test(low) ? 'allEnemies' : 'target';
    ops.push({ op: 'debuff', attack: +m[1], health: +m[2], scope, duration: durationOf(low) });
    if (scope === 'target') { needsTarget = true; targetKind = 'enemy'; }
  } else {
    if ((m = low.match(/(?:gets|get) -(\d+) attack/))) {
      const scope = /all enemy creatures/.test(low) ? 'allEnemies' : 'target';
      ops.push({ op: 'debuff', attack: +m[1], health: 0, scope, duration: durationOf(low) });
      if (scope === 'target') { needsTarget = true; targetKind = 'enemy'; }
    }
    if ((m = low.match(/(?:gets|get) -(\d+) health/))) {
      const scope = /all enemy creatures/.test(low) ? 'allEnemies' : 'target';
      ops.push({ op: 'debuff', attack: 0, health: +m[1], scope, duration: durationOf(low) });
      if (scope === 'target') { needsTarget = true; targetKind = 'enemy'; }
    }
  }

  // --- Keyword grants ---
  for (const kw of KEYWORDS) {
    const re = new RegExp('gains? ' + kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (re.test(low)) {
      ops.push({ op: 'grantKeyword', keyword: kw, scope: 'target', duration: durationOf(low) });
      needsTarget = true; targetKind = 'friendly';
    }
  }

  // --- Poison ---
  if ((m = low.match(/(?:gets|get) poison (\d+)/))) {
    ops.push({ op: 'poison', amount: +m[1], scope: /all enemy/.test(low) ? 'allEnemies' : 'target' });
    if (!/all enemy/.test(low)) { needsTarget = true; targetKind = 'enemy'; }
  }

  // --- Token creation ---
  if ((m = low.match(/create (a|an|two|three|four|\d+) (\d+)\/(\d+)[^.]*?token/))) {
    const tk = [];
    for (const kw of KEYWORDS) if (new RegExp(kw.toLowerCase()).test(m[0])) tk.push(kw);
    ops.push({ op: 'token', count: num(m[1]), attack: +m[2], health: +m[3], keywords: tk });
  }

  // Did we recognise the entire effect? If the text is non-trivial but we found
  // no ops, mark it manual. Creatures/equipment with passive text also flagged.
  const automated = ops.length > 0;
  const trivial = !text || /^none$/i.test(text);

  return { ops, needsTarget, targetKind, automated, manual: !automated && !trivial, text };
}

// Apply parsed ops to the game via a facade. ctx = { playerId, side, targets:[instId|'dmFace'|'partyFace'] }
export function apply(game, card, ctx, info) {
  const a = info || analyze(card);
  const side = ctx.side || 'party';
  const enemySide = side === 'party' ? 'dm' : 'party';
  const targetInst = ctx.targets && ctx.targets[0];

  for (const op of a.ops) {
    switch (op.op) {
      case 'damage':
        if (op.scope === 'target' && targetInst) game.damageTarget(targetInst, op.amount, ctx);
        else if (op.scope === 'allEnemies') game.damageAll(enemySide, op.amount);
        else if (op.scope === 'allCreatures') { game.damageAll('party', op.amount); game.damageAll('dm', op.amount); }
        else if (op.scope === 'dmFace') game.damageFace(enemySide, op.amount);
        break;
      case 'draw':
        game.drawFor(ctx.playerId, op.amount);
        break;
      case 'mana':
        game.addMana(op.amount, op.burst);
        break;
      case 'healHP':
        game.healParty(op.amount);
        break;
      case 'shieldHP':
        game.addPartyShield(op.amount);
        break;
      case 'healCreature':
        if (targetInst) game.healCreature(targetInst, op.amount);
        break;
      case 'buff':
        if (op.scope === 'allFriendly') game.buffSide(side, op.attack, op.health, op.duration);
        else if (targetInst) game.buffCreature(targetInst, op.attack, op.health, op.duration);
        break;
      case 'debuff':
        if (op.scope === 'allEnemies') game.buffSide(enemySide, -op.attack, -op.health, op.duration);
        else if (targetInst) game.buffCreature(targetInst, -op.attack, -op.health, op.duration);
        break;
      case 'grantKeyword':
        if (targetInst) game.grantKeyword(targetInst, op.keyword, op.duration);
        break;
      case 'poison':
        if (op.scope === 'allEnemies') game.poisonSide(enemySide, op.amount);
        else if (targetInst) game.poisonCreature(targetInst, op.amount);
        break;
      case 'token':
        game.createTokens(side, op.count, op.attack, op.health, op.keywords);
        break;
    }
  }
  return a;
}

export default { analyze, apply };
