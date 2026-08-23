import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ABILITY_KEYS,
  PRESETS,
  rollDice, roll4d6DropLowest, roll3d6Set, rollAbilityScores, assignByPreference,
  modifier, proficiencyBonus, carryingCapacity, passivePerception,
  XP_TABLE_D20, XP_TABLE_OSR, levelFromXp,
  validateCharacter, migrate, serializeCharacter, deserializeCharacter,
} from '../js/logic.js';

// deterministic rng
const fixed = (seq) => {
  let i = 0;
  return () => seq[i++ % seq.length];
};

test('rollDice respects bounds and count with a seeded rng', () => {
  const d = rollDice(4, 6, fixed([0.0, 0.9999, 0.5, 0.24]));
  assert.equal(d.length, 4);
  for (const face of d) {
    assert.ok(face >= 1 && face <= 6);
  }
});

test('roll4d6DropLowest drops the lowest die', () => {
  const score = roll4d6DropLowest(fixed([0.5 / 6, 1.5 / 6, 2.5 / 6, 3.5 / 6]));
  // dice are 1,2,3,4 -> drop the 1 -> 9
  assert.equal(score, 9);
});

test('roll3d6Set returns six scores within 3..18', () => {
  const set = roll3d6Set(fixed(Array.from({ length: 60 }, (_, i) => (i * 37 % 100) / 100)));
  assert.equal(set.length, 6);
  for (const s of set) assert.ok(s >= 3 && s <= 18);
});

test('rollAbilityScores produces six valid 4d6-drop-lowest scores', () => {
  const scores = rollAbilityScores(() => 0.42);
  assert.equal(scores.length, 6);
  for (const s of scores) {
    assert.ok(Number.isInteger(s) && s >= 3 && s <= 18);
  }
});

test('assignByPreference gives priority abilities the highest rolls', () => {
  const assigned = assignByPreference([16, 14, 13, 12, 10, 8], ['CHA', 'DEX', 'CON']);
  assert.equal(assigned.CHA, 16);
  assert.equal(assigned.DEX, 14);
  assert.equal(assigned.CON, 13);
  assert.deepEqual(Object.keys(assigned).sort(), [...ABILITY_KEYS].sort());
  // leftovers (12,10,8) fill remaining abilities
  const rest = Object.values(assigned).filter((_, i) => i >= 3).sort((a, b) => b - a);
  assert.deepEqual(rest, [12, 10, 8]);
});

test('assignByPreference rejects garbage input', () => {
  assert.throws(() => assignByPreference([]));
  assert.throws(() => assignByPreference([15, 'x']));
});

test('modifier matches the 5e table', () => {
  assert.equal(modifier(1), -5);
  assert.equal(modifier(8), -1);
  assert.equal(modifier(10), 0);
  assert.equal(modifier(11), 0);
  assert.equal(modifier(12), +1);
  assert.equal(modifier(20), +5);
  assert.equal(modifier(30), +10);
});

test('proficiencyBonus follows level bands (+2 to +6)', () => {
  assert.equal(proficiencyBonus(1), 2);
  assert.equal(proficiencyBonus(4), 2);
  assert.equal(proficiencyBonus(5), 3);
  assert.equal(proficiencyBonus(8), 3);
  assert.equal(proficiencyBonus(9), 4);
  assert.equal(proficiencyBonus(17), 6);
  assert.equal(proficiencyBonus(20), 6);
  // out-of-range levels clamp
  assert.equal(proficiencyBonus(0), 2);
  assert.equal(proficiencyBonus(99), 6);
});

test('carrying capacity is STR x 15 lb', () => {
  assert.equal(carryingCapacity(10), 150);
  assert.equal(carryingCapacity(20), 300);
  assert.equal(carryingCapacity(-5), 0);
  assert.equal(carryingCapacity(NaN), 0);
});

test('passive perception is 10 + WIS mod', () => {
  assert.equal(passivePerception(10), 10);
  assert.equal(passivePerception(20), 15);
  assert.equal(passivePerception(1), 5);
});

test('levelFromXp walks both XP tables correctly', () => {
  assert.equal(levelFromXp(0, 'd20').level, 1);
  assert.equal(levelFromXp(299, 'd20').level, 1);
  assert.equal(levelFromXp(300, 'd20').level, 2);
  assert.equal(levelFromXp(6499, 'd20').level, 4);
  assert.equal(levelFromXp(6500, 'd20').level, 5);
  const cap = levelFromXp(355000, 'd20');
  assert.equal(cap.level, 20);
  assert.equal(cap.nextAt, null); // at cap there is no next threshold
  assert.equal(levelFromXp(2029, 'osr').level, 1);
  assert.equal(levelFromXp(2035, 'osr').level, 2);
  assert.equal(levelFromXp(999999, 'osr').level, 8);
  // negative xp clamps to level 1
  assert.equal(levelFromXp(-50, 'd20').level, 1);
});

test('XP tables are strictly increasing and well-formed', () => {
  assert.equal(XP_TABLE_D20.length, 20);
  assert.equal(XP_TABLE_OSR.length, 8);
  for (const table of [XP_TABLE_D20, XP_TABLE_OSR]) {
    for (let i = 1; i < table.length; i++) {
      assert.ok(table[i] > table[i - 1]);
    }
  }
});

const goodD20 = {
  system: 'd20',
  name: 'Brissa Emberhand',
  class: 'Wizard',
  race: 'Human',
  level: 5,
  hp: 28,
  ac: 12,
  abilities: { STR: 8, DEX: 14, CON: 12, INT: 16, WIS: 10, CHA: 12 },
  gearWeightLb: 40,
};

test('validateCharacter accepts a complete d20 sheet', () => {
  const { errors } = validateCharacter(goodD20);
  assert.deepEqual(errors, []);
});

test('validateCharacter flags missing name and bad level/abilities/hp', () => {
  const r = validateCharacter({
    system: 'd20',
    name: '   ',
    level: 25,
    hp: 0,
    abilities: { STR: 25, DEX: 0, XXL: 10 },
  });
  assert.ok(r.errors.includes('name.required'));
  assert.ok(r.errors.includes('level.range'));
  assert.ok(r.errors.includes('ability.range'));
  assert.ok(r.errors.includes('hp.range'));
  assert.ok(r.errors.some((e) => e.startsWith('ability.unknown:XXL')));
});

test('validateCharacter enforces OSR bounds (3-18, cap 8)', () => {
  const r = validateCharacter({
    system: 'osr',
    name: 'Grimwald',
    level: 12,
    hp: 4,
    abilities: { STR: 19, DEX: 9 },
  });
  assert.ok(r.errors.includes('level.range'));
  assert.ok(r.errors.includes('ability.range'));
});

test('validateCharacter warns on overload and skips scoring in freeform', () => {
  const heavy = validateCharacter({ ...goodD20, gearWeightLb: 999 });
  assert.ok(heavy.warnings.includes('gear.overloaded'));
  const ff = validateCharacter({
    system: 'freeform',
    name: 'The Nameless Knight',
    abilities: {},
    level: 999,
    hp: -3,
  });
  assert.deepEqual(ff.errors, []); // freeform has no numeric constraints
});

test('migrate upgrades v1 lowercase flat sheets to v2 nested shape', () => {
  const v1 = { str: 14, dex: 16, con: 12, int: 15, wis: 11, cha: 9, name: 'Old Hero' };
  const m = migrate(v1);
  assert.equal(m.sheetVersion, 2);
  assert.equal(m.system, 'd20');
  assert.equal(m.abilities.STR, 14);
  assert.equal(m.abilities.CHA, 9);
  assert.equal(m.str, undefined);
  // already-v2 sheets pass through untouched (version stamped)
  const again = migrate(m);
  assert.equal(again.sheetVersion, 2);
  assert.equal(again.abilities.DEX, 16);
});

test('serialize/deserialize round-trips and rejects junk', () => {
  const text = serializeCharacter(goodD20);
  const back = deserializeCharacter(text);
  assert.equal(back.name, 'Brissa Emberhand');
  assert.equal(back.sheetVersion, 2);
  assert.deepEqual(back.abilities, goodD20.abilities);
  assert.throws(() => deserializeCharacter('{not json'));
  assert.throws(() => deserializeCharacter('[1,2,3]'));
});

test('presets expose coherent capabilities', () => {
  assert.equal(PRESETS.d20.maxLevel, 20);
  assert.equal(PRESETS.osr.saves, 'classic');
  assert.equal(PRESETS.freeform.usesSkills, false);
});
