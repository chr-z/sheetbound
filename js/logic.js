// SheetBound — core business logic (zero dependencies)
// Dice math, 5e-style derived stats, XP progression, sheet validation,
// schema migration and JSON (de)serialization.

export const SHEET_VERSION = 2;

export const ABILITY_KEYS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

export const PRESETS = {
  d20: {
    id: 'd20',
    usesSkills: true,
    usesProficiency: true,
    saves: 'abilities',
    maxLevel: 20,
    minScore: 1,
    maxScore: 20,
  },
  osr: {
    id: 'osr',
    usesSkills: false,
    usesProficiency: false,
    saves: 'classic',
    maxLevel: 8,
    minScore: 3,
    maxScore: 18,
  },
  freeform: {
    id: 'freeform',
    usesSkills: false,
    usesProficiency: false,
    saves: 'none',
    maxLevel: null,
    minScore: null,
    maxScore: null,
  },
};

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

/** Roll `count` dice of `sides` sides using rng() -> [0,1). Returns sorted desc. */
export function rollDice(count, sides, rng = Math.random) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const raw = Math.floor(rng() * sides) + 1;
    out.push(Math.min(Math.max(raw, 1), sides));
  }
  return out.sort((a, b) => b - a);
}

/** 4d6 drop lowest → single score. */
export function roll4d6DropLowest(rng = Math.random) {
  const dice = rollDice(4, 6, rng);
  return dice[0] + dice[1] + dice[2];
}

/** Classic 3d6 set. */
export function roll3d6Set(rng = Math.random) {
  return Array.from({ length: 6 }, () =>
    rollDice(3, 6, rng).reduce((a, b) => a + b, 0)
  );
}

/** Full 5e-style set: six best-of-4d6 rolls. */
export function rollAbilityScores(rng = Math.random) {
  return Array.from({ length: 6 }, () => roll4d6DropLowest(rng));
}

/**
 * Greedy assignment of rolled scores to abilities following a priority list.
 * Highest roll goes to the first preferred ability still unassigned;
 * leftovers fill remaining abilities in listed order.
 */
export function assignByPreference(rolls, preference = ABILITY_KEYS) {
  if (!Array.isArray(rolls) || rolls.length === 0 || rolls.some((r) => !Number.isFinite(r))) {
    throw new Error('invalid rolls');
  }
  const pool = [...rolls].sort((a, b) => b - a);
  const assigned = {};
  const remaining = new Set(ABILITY_KEYS);
  for (const pref of preference) {
    const key = String(pref).toUpperCase();
    if (!remaining.has(key)) continue;
    assigned[key] = pool.shift();
    remaining.delete(key);
  }
  for (const key of remaining) {
    assigned[key] = pool.shift();
  }
  return assigned;
}

// ---------------------------------------------------------------------------
// Derived stats (d20 / 5e-style)
// ---------------------------------------------------------------------------

/** Ability modifier: floor((score - 10) / 2). */
export function modifier(score) {
  if (!Number.isFinite(score)) return 0;
  return Math.floor((score - 10) / 2);
}

/** Proficiency bonus by character level: 2 + floor((level-1)/4), capped 1..20. */
export function proficiencyBonus(level) {
  const lvl = Math.min(Math.max(Math.floor(level) || 1, 1), 20);
  return 2 + Math.floor((lvl - 1) / 4);
}

/** Carrying capacity in pounds: STR × 15 (5e rule). */
export function carryingCapacity(strScore) {
  const s = Number.isFinite(strScore) ? Math.max(strScore, 0) : 0;
  return s * 15;
}

/** Passive perception (10 + WIS modifier). */
export function passivePerception(wisScore) {
  return 10 + modifier(wisScore);
}

// ---------------------------------------------------------------------------
// XP progression
// ---------------------------------------------------------------------------

// Official 5e XP thresholds for levels 1..20.
export const XP_TABLE_D20 = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000,
  120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];

// Old-school style (B/X-inspired) thresholds for levels 1..8.
export const XP_TABLE_OSR = [0, 2035, 4070, 8140, 16285, 32570, 65140, 130280];

/**
 * Level from total XP. Returns { level, nextAt } where nextAt is the XP
 * needed for the next level or null when at cap.
 */
export function levelFromXp(xp, system = 'd20') {
  const table = system === 'osr' ? XP_TABLE_OSR : XP_TABLE_D20;
  const total = Math.max(Math.floor(Number(xp)) || 0, 0);
  let level = 1;
  for (let i = 0; i < table.length; i++) {
    if (total >= table[i]) level = i + 1;
  }
  const capped = level >= table.length;
  return { level, nextAt: capped ? null : table[level] };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ABILITY_RE = /^[A-Za-z]{3}$/;

/**
 * Validate a character sheet against its preset.
 * Returns { errors: string[], warnings: string[] } — stable machine codes like
 * 'name.required', 'ability.range', 'level.range', 'hp.range', 'gear.overloaded'.
 */
export function validateCharacter(sheet) {
  const errors = [];
  const warnings = [];
  const preset = PRESETS[sheet?.system] || PRESETS.freeform;

  if (!sheet || typeof sheet !== 'object') {
    return { errors: ['sheet.not_object'], warnings };
  }
  if (!sheet.name || !String(sheet.name).trim()) {
    errors.push('name.required');
  }

  if (preset.id !== 'freeform') {
    if (preset.maxLevel != null) {
      const lvl = Number(sheet.level);
      if (!Number.isInteger(lvl) || lvl < 1 || lvl > preset.maxLevel) {
        errors.push('level.range');
      }
    }
    const abilities = sheet.abilities || {};
    for (const key of Object.keys(abilities)) {
      if (!ABILITY_RE.test(key) || !ABILITY_KEYS.includes(key.toUpperCase())) {
        errors.push(`ability.unknown:${key}`);
        continue;
      }
      const v = Number(abilities[key]);
      if (
        !Number.isInteger(v) ||
        v < preset.minScore ||
        v > preset.maxScore
      ) {
        errors.push('ability.range');
      }
    }
    const hp = Number(sheet.hp);
    if (!Number.isFinite(hp) || hp < 1) {
      errors.push('hp.range');
    }
  }

  // Encumbrance warning (both scored systems)
  if (preset.id !== 'freeform' && sheet.gearWeightLb != null) {
    const cap = carryingCapacity(
      Number(sheet.abilities && sheet.abilities.STR) || 0
    );
    const weight = Number(sheet.gearWeightLb) || 0;
    if (cap > 0 && weight > cap) {
      warnings.push('gear.overloaded');
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Schema migration & serialization
// ---------------------------------------------------------------------------

/** Migrate any known sheet shape to SHEET_VERSION, preserving user data. */
export function migrate(sheet) {
  if (!sheet || typeof sheet !== 'object') {
    throw new Error('not a sheet');
  }
  // v1 shape: lowercase flat ability fields (str/dex/...), no sheetVersion.
  const looksV1 =
    sheet.sheetVersion == null &&
    ('str' in sheet || 'dex' in sheet) &&
    !sheet.abilities;

  const out = {
    system: 'd20',
    name: '',
    class: '',
    level: 1,
    race: '',
    hp: 10,
    ac: 10,
    abilities: {},
    saves: [],
    skills: [],
    gear: [],
    gearWeightLb: 0,
    notes: {},
    ...structuredClone(sheet),
  };

  if (looksV1) {
    const ab = {};
    for (const key of ABILITY_KEYS) {
      const lower = key.toLowerCase();
      if (lower in out) {
        ab[key] = Number(out[lower]) || 10;
        delete out[lower];
      }
    }
    out.abilities = { ...ab, ...out.abilities };
  }

  out.sheetVersion = SHEET_VERSION;
  if (!PRESETS[out.system]) out.system = 'd20';
  return out;
}

/** Serialize to pretty JSON string tagged with the current version. */
export function serializeCharacter(sheet) {
  const migrated = migrate(sheet);
  return JSON.stringify(migrated, null, 2);
}

/**
 * Parse a previously exported JSON string.
 * Throws Error('invalid sheet json') on unparsable content or wrong shape.
 */
export function deserializeCharacter(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('invalid sheet json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid sheet json');
  }
  return migrate(parsed);
}
