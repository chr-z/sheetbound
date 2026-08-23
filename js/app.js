// SheetBound — app shell: state, bindings, system switching, live print preview.
import {
  ABILITY_KEYS,
  rollAbilityScores, roll3d6Set, assignByPreference,
  modifier, proficiencyBonus, carryingCapacity, passivePerception,
  levelFromXp,
  serializeCharacter, deserializeCharacter,
} from './logic.js';
import { initLanguage, setLanguage, t } from './i18n.js';

const LS_KEY = 'sheetbound.sheet.v2';
const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------------ state
let system = 'd20';
let abilities = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
let saves = [];
let skills = [];
let gear = [{ item: 'Backpack', qty: 1, weightLb: 1 }];

const SKILL_LIST = [
  ['Acrobatics', 'DEX'], ['Animal Handling', 'WIS'], ['Arcana', 'INT'],
  ['Athletics', 'STR'], ['Deception', 'CHA'], ['History', 'INT'],
  ['Insight', 'WIS'], ['Intimidation', 'CHA'], ['Investigation', 'INT'],
  ['Medicine', 'WIS'], ['Nature', 'WIS'], ['Perception', 'WIS'],
  ['Performance', 'CHA'], ['Persuasion', 'CHA'], ['Religion', 'INT'],
  ['Sleight of Hand', 'DEX'], ['Stealth', 'DEX'], ['Survival', 'WIS'],
];

const OSR_SAVES = [
  'Poison or Death',
  'Wands',
  'Paralysis or Petrification',
  'Dragon Breath',
  'Spells',
  'Devices & Staffs',
];

const D20_SKILL_NAMES = SKILL_LIST.map(([name, abbr]) => `${name} (${abbr})`);

// --------------------------------------------------------------- helpers
function el(tag, attrs = {}) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function setStatus(msg) {
  $('#status').textContent = msg;
}

function toggleListItem(list, value, on) {
  const i = list.indexOf(value);
  if (on && i === -1) list.push(value);
  if (!on && i !== -1) list.splice(i, 1);
}

function formatSigned(n) {
  if (!Number.isFinite(n)) return '+0';
  return n >= 0 ? `+${n}` : String(n);
}

function chip(labelText, checked, onChange) {
  const label = el('label');
  label.className = 'chip';
  const box = el('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  label.append(box, document.createTextNode(labelText));
  return label;
}

// ------------------------------------------------------------- rendering
function renderAbilities() {
  const grid = $('#ability-grid');
  grid.textContent = '';
  const min = system === 'osr' ? 3 : 1;
  const max = system === 'osr' ? 18 : 20;
  for (const key of ABILITY_KEYS) {
    const wrap = el('div');
    wrap.className = 'ability';
    const label = el('label');
    label.setAttribute('for', `ab-${key}`);
    const span = el('span');
    span.dataset.i18n = `ability.${key}`;
    const input = el('input');
    input.type = 'number';
    input.id = `ab-${key}`;
    input.min = String(min);
    input.max = String(max);
    input.value = String(abilities[key] ?? 10);
    input.addEventListener('input', () => {
      abilities[key] = parseInt(input.value, 10) || 0;
      syncPreview();
      saveLocal();
    });
    label.append(span, input);
    wrap.append(label);
    grid.append(wrap);
  }
}

function renderSaves() {
  const row = $('#saves-row');
  row.textContent = '';
  if (system === 'd20') {
    for (const key of ABILITY_KEYS) {
      row.append(chip(key, saves.includes(key), (on) => toggleListItem(saves, key, on)));
    }
  } else if (system === 'osr') {
    for (const name of OSR_SAVES) {
      row.append(chip(name, saves.includes(name), (on) => toggleListItem(saves, name, on)));
    }
  }
}

function renderSkills() {
  const row = $('#skills-row');
  row.textContent = '';
  if (system !== 'd20') return;
  for (const name of D20_SKILL_NAMES) {
    row.append(chip(name, skills.includes(name), (on) => toggleListItem(skills, name, on)));
  }
}

function renderGear() {
  const body = $('#gear-body');
  body.textContent = '';
  gear.forEach((rowObj, idx) => {
    const tr = el('tr');

    const tdItem = el('td');
    const inItem = el('input');
    inItem.type = 'text';
    inItem.value = rowObj.item;
    inItem.setAttribute('aria-label', `${t_gear('item')} ${idx + 1}`);
    inItem.addEventListener('input', () => {
      rowObj.item = inItem.value;
      syncPreview();
      saveLocal();
    });
    tdItem.append(inItem);

    const tdQty = el('td', { class: 'num' });
    const inQty = el('input');
    inQty.type = 'number';
    inQty.min = '0';
    inQty.value = String(rowObj.qty ?? 1);
    inQty.setAttribute('aria-label', `${t_gear('qty')} ${idx + 1}`);
    inQty.addEventListener('input', () => {
      rowObj.qty = parseInt(inQty.value, 10) || 0;
      syncPreview();
      saveLocal();
    });
    tdQty.append(inQty);

    const tdWt = el('td', { class: 'num' });
    const inWt = el('input');
    inWt.type = 'number';
    inWt.min = '0';
    inWt.step = 'any';
    inWt.value = String(rowObj.weightLb ?? 0);
    inWt.setAttribute('aria-label', `${t_gear('weight')} ${idx + 1}`);
    inWt.addEventListener('input', () => {
      rowObj.weightLb = parseFloat(inWt.value) || 0;
      syncPreview();
      saveLocal();
    });
    tdWt.append(inWt);

    const tdX = el('td');
    const btnX = el('button');
    btnX.type = 'button';
    btnX.className = 'btn-icon';
    btnX.textContent = '✕';
    btnX.setAttribute('aria-label', `remove ${idx + 1}`);
    btnX.addEventListener('click', () => {
      gear.splice(idx, 1);
      renderGear();
      syncPreview();
      saveLocal();
    });
    tdX.append(btnX);

    tr.append(tdItem, tdQty, tdWt, tdX);
    body.append(tr);
  });
}

function t_gear(key) {
  // small helper so gear labels survive re-render before first i18n tick
  return { item: 'Item', qty: 'Qty', weight: 'Weight (lb)' }[key] || key;
}

function applyI18nDynamic() {
  OVERLOAD_MSG = t('status.overloaded');
}

// ------------------------------------------------------------ live preview
function appendItems(listNode, items) {
  for (const item of items) {
    const li = el('li');
    li.textContent = item;
    listNode.append(li);
  }
}

function totalGearWeightLb() {
  return gear.reduce((acc, g) => acc + (g.weightLb || 0) * (g.qty || 0), 0);
}

function syncPreview() {
  $('#s-name').textContent = $('#f-name').value.trim() || '—';

  const cls = $('#f-class').value.trim();
  const race = $('#f-race').value.trim();
  const parts = [cls, race].filter(Boolean).join(' · ');
  $('#s-subline').textContent = parts || '—';

  $('#s-level').textContent = $('#f-level').value || '—';
  $('#s-hp').textContent = $('#f-hp').value || '—';
  $('#s-ac').textContent = $('#f-ac').value || '—';

  const hexRow = $('#s-abilities');
  hexRow.textContent = '';
  if (system !== 'freeform') {
    for (const key of Object.keys(abilities)) {
      const cell = el('div');
      cell.className = 'hex';
      const b = el('b');
      b.textContent = String(abilities[key] ?? '');
      const small = el('small');
      small.textContent = key;
      const modSpan = el('span');
      modSpan.className = 'mod';
      modSpan.textContent = formatSigned(modifier(Number(abilities[key] || 0)));
      cell.append(b, small, modSpan);
      hexRow.append(cell);
    }
  }

  const ulSaves = $('#s-saves');
  ulSaves.textContent = '';
  if (saves.length) appendItems(ulSaves, saves);
  else ulSaves.textContent = '—';

  const ulSkills = $('#s-skills');
  ulSkills.textContent = '';
  if (skills.length) appendItems(ulSkills, skills);
  else ulSkills.textContent = '—';

  const sBody = $('#s-gear');
  sBody.textContent = '';
  for (const g of gear) {
    if (!g.item && !g.weightLb) continue;
    const tr = el('tr');
    const tdA = el('td');
    tdA.textContent = g.item || '—';
    const tdB = el('td', { class: 'num' });
    tdB.textContent = String(g.qty || 0);
    const tdC = el('td', { class: 'num' });
    const lineTotal = Math.round((g.weightLb || 0) * (g.qty || 0) * 10) / 10;
    tdC.textContent = String(lineTotal);
    tr.append(tdA, tdB, tdC);
    sBody.append(tr);
  }

  const totalWeight = Math.round(totalGearWeightLb() * 10) / 10;
  $('#gear-total').textContent = `${t_gear('total')} ${totalWeight} lb`;

  $('#s-appearance').textContent = $('#n-appearance').value.trim() || '—';
  $('#s-bond').textContent = $('#n-bond').value.trim() || '—';
  $('#s-flaw').textContent = $('#n-flaw').value.trim() || '—';

  const level = parseInt($('#f-level').value, 10) || 1;
  const prof = `+${proficiencyBonus(level)}`;
  $('#d-prof').textContent = prof;
  $('#sp-prof').textContent = prof;
  // XP → level hint (d20 table)
  const xpVal = parseInt($('#f-xp').value, 10);
  const lvlHint = Number.isFinite(xpVal)
    ? levelFromXp(xpVal, system === 'osr' ? 'osr' : 'd20')
    : null;
  if (lvlHint && String(lvlHint.level) !== $('#s-level').textContent) {
    $('#s-level').textContent = String(lvlHint.level);
  }
  const pp = String(passivePerception(Number(abilities.WIS) || 0));
  $('#d-pp').textContent = pp;
  $('#sp-pp').textContent = pp;
  $('#d-cap').textContent = `${carryingCapacity(Number(abilities.STR) || 0)} lb`;

  const statusNode = $('#status');
  const overloaded =
    system !== 'freeform' &&
    totalWeight > 0 &&
    totalWeight > carryingCapacity(Number(abilities.STR) || 0);
  if (overloaded) {
    statusNode.dataset.overloaded = 'true';
    statusNode.textContent = t_statusOverloaded();
  } else if (statusNode.dataset.overloaded === 'true') {
    statusNode.dataset.overloaded = 'false';
    statusNode.textContent = '';
  }
}

let OVERLOAD_MSG = 'Over carrying capacity!';
export function __setOverloadMsg(msg) { OVERLOAD_MSG = msg || OVERLOAD_MSG; }
function t_statusOverloaded() { return OVERLOAD_MSG; }

// ------------------------------------------------------- system switching
function applySystemVisibility() {
  document.body.dataset.system = system;
}

// ---------------------------------------------------------- persistence
function collectSheet() {
  return {
    sheetVersion: 2,
    system,
    name: $('#f-name').value,
    class: $('#f-class').value,
    race: $('#f-race').value,
    level: parseInt($('#f-level').value, 10) || 1,
    xp: parseInt($('#f-xp') ? $('#f-xp').value : '0', 10) || 0,
    hp: parseFloat($('#f-hp').value) || 1,
    ac: parseFloat($('#f-ac').value) || 10,
    abilities: { ...abilities },
    saves: [...saves],
    skills: [...skills],
    gear: gear.map((g) => ({ ...g })),
    notes: {
      appearance: $('#n-appearance').value,
      bond: $('#n-bond').value,
      flaw: $('#n-flaw').value,
    },
  };
}

function saveLocal() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(collectSheet()));
  } catch { /* storage blocked */ }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function fillForm(sheet) {
  system = ['d20', 'osr', 'freeform'].includes(sheet.system) ? sheet.system : 'd20';
  abilities = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
  for (const [k, v] of Object.entries(sheet.abilities || {})) {
    abilities[k.toUpperCase()] = Number(v) || 0;
  }
  saves = Array.isArray(sheet.saves) ? [...sheet.saves] : [];
  skills = Array.isArray(sheet.skills) ? [...sheet.skills] : [];
  gear = Array.isArray(sheet.gear) && sheet.gear.length
    ? sheet.gear.map((g) => ({
        item: String(g.item || ''),
        qty: parseInt(g.qty, 10) || 0,
        weightLb: parseFloat(g.weightLb) || 0,
      }))
    : [{ item: '', qty: 1, weightLb: 0 }];

  $('#f-name').value = sheet.name || '';
  $('#f-class').value = sheet.class || '';
  $('#f-race').value = sheet.race || '';
  $('#f-level').value = String(sheet.level || 1);
  $('#f-xp').value = String(sheet.xp != null ? sheet.xp : 0);
  $('#f-hp').value = String(sheet.hp || 10);
  $('#f-ac').value = String(sheet.ac != null ? sheet.ac : 10);
  $('#n-appearance').value = (sheet.notes && sheet.notes.appearance) || '';
  $('#n-bond').value = (sheet.notes && sheet.notes.bond) || '';
  $('#n-flaw').value = (sheet.notes && sheet.notes.flaw) || '';

  document.querySelectorAll('.sys-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.system === system);
  });
  renderAbilities();
  renderSaves();
  renderSkills();
  renderGear();
  applySystemVisibility();
  syncPreview();
}

// ------------------------------------------------------------- demo data
function demoCharacter(sys) {
  const base = {
    d20: {
      system: 'd20',
      name: 'Brissa Emberhand',
      class: 'Wizard',
      race: 'Human',
      level: 5,
      xp: 6500,
      hp: 28,
      ac: 12,
      abilities: { STR: 8, DEX: 14, CON: 12, INT: 16, WIS: 10, CHA: 12 },
      saves: ['INT', 'WIS'],
      skills: ['Arcana (INT)', 'Investigation (INT)', 'Insight (WIS)'],
      gear: [
        { item: 'Quarterstaff', qty: 1, weightLb: 4 },
        { item: 'Spellbook', qty: 1, weightLb: 3 },
        { item: 'Rope (50 ft)', qty: 1, weightLb: 10 },
        { item: 'Healing potion', qty: 2, weightLb: 0.5 },
      ],
      notes: {
        appearance: 'Silver braid, ink-stained fingers, scorched sleeve.',
        bond: 'Owes the academy library a very expensive replacement.',
        flaw: 'Reads scrolls she should not read.',
      },
    },
    osr: {
      system: 'osr',
      name: 'Grimwald the Gatekeeper',
      class: 'Fighting Man',
      race: '—',
      level: 3,
      hp: 11,
      ac: 5,
      abilities: { STR: 15, DEX: 9, CON: 14, INT: 8, WIS: 12, CHA: 10 },
      saves: [OSR_SAVES[0], OSR_SAVES[1]],
      skills: [],
      gear: [
        { item: 'Longsword', qty: 1, weightLb: 4 },
        { item: 'Chain mail', qty: 1, weightLb: 30 },
        { item: 'Shield', qty: 1, weightLb: 10 },
        { item: 'Torch', qty: 6, weightLb: 1 },
      ],
      notes: {
        appearance: 'Scarred knuckles, dented helm, patient eyes.',
        bond: 'Guards the east gate; owes the guild two seasons of dues.',
        flaw: 'Never retreats first.',
      },
    },
    freeform: {
      system: 'freeform',
      name: 'The Lighthouse Keeper',
      class: '',
      race: '',
      hp: 3,
      ac: 10,
      abilities: {},
      saves: [],
      skills: [],
      gear: [
        { item: 'Oil lantern', qty: 1, weightLb: 2 },
        { item: "Keeper's logbook", qty: 1, weightLb: 1 },
        { item: 'Brass key ring', qty: 1, weightLb: 0.3 },
      ],
      notes: {
        appearance: 'Salt-weathered coat, steady gaze.',
        bond: 'The light must never go out.',
        flaw: "Hasn't slept in years.",
      },
    },
  };
  return base[sys] || base.d20;
}

// ---------------------------------------------------------------- events
function bindStaticFields() {
  const ids = [
    '#f-name', '#f-class', '#f-race', '#f-level', '#f-xp', '#f-hp', '#f-ac',
    '#n-appearance', '#n-bond', '#n-flaw',
  ];
  for (const id of ids) {
    $(id).addEventListener('input', () => {
      syncPreview();
      saveLocal();
    });
  }
}

function wireEvents() {
  document.querySelectorAll('.sys-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      system = btn.dataset.system;
      document.querySelectorAll('.sys-btn').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
      });
      saves = [];
      skills = [];
      abilities = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
      renderAbilities();
      renderSaves();
      renderSkills();
      applySystemVisibility();
      syncPreview();
      saveLocal();
    });
  });

  $('#btn-roll').addEventListener('click', () => {
    const rolls = rollAbilityScores();
    const prefs = ['CON', 'DEX'];
    abilities = assignByPreference(rolls, prefs);
    renderAbilities();
    syncPreview();
    saveLocal();
  });

  $('#btn-roll3d6').addEventListener('click', () => {
    const set = roll3d6Set();
    abilities = assignByPreference(set, ['CON', 'DEX']);
    renderAbilities();
    syncPreview();
    saveLocal();
  });

  $('#btn-demo').addEventListener('click', () => {
    fillForm(demoCharacter(system));
    saveLocal();
  });

  $('#btn-print').addEventListener('click', () => window.print());

  $('#btn-add-gear').addEventListener('click', () => {
    gear.push({ item: '', qty: 1, weightLb: 0 });
    renderGear();
    syncPreview();
  });

  $('#btn-export').addEventListener('click', () => {
    const text = serializeCharacter(collectSheet());
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const slug = ($('#f-name').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')) || 'character';
    a.download = `${slug}-sheetbound.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const parsed = deserializeCharacter(await file.text());
      fillForm(parsed);
      saveLocal();
      setStatus('Imported.');
    } catch {
      setStatus('Invalid file.');
    }
  });

  window.addEventListener('beforeprint', syncPreview);
  setInterval(saveLocal, 15000);
}

// ------------------------------------------------------------------ boot
async function boot() {
  const resolved = await initLanguage();
  applyI18nDynamic();
  const langSel = $('#lang-select');
  langSel.value = resolved;
  langSel.addEventListener('change', () => {
    setLanguage(langSel.value).then(() => {
      applyI18nDynamic();
      renderGear();
      syncPreview();
    });
  });

  bindStaticFields();
  wireEvents();
  applySystemVisibility();

  const saved = loadLocal();
  if (saved) fillForm(saved);
  else fillForm(demoCharacter(system));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
