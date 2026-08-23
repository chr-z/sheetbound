// Minimal i18n engine: loads /locales/<lang>.json, falls back to en, persists choice.
const SUPPORTED = ['en', 'pt-BR'];
const LS_KEY = 'sheetbound.lang';

let dict = {};
let lang = 'en';

export function supportedLanguages() {
  return [...SUPPORTED];
}

export function currentLanguage() {
  return lang;
}

function deepGet(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function apply(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = deepGet(dict, el.getAttribute('data-i18n'));
    if (typeof v === 'string') el.textContent = v;
  });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    const v = deepGet(dict, el.getAttribute('data-i18n-ph'));
    if (typeof v === 'string') el.setAttribute('placeholder', v);
  });
}

export async function initLanguage(preferred) {
  const saved = localStorage.getItem(LS_KEY);
  const nav = (navigator.language || 'en').slice(0, 2) === 'pt' ? 'pt-BR' : 'en';
  lang = preferred || saved || nav;
  if (!SUPPORTED.includes(lang)) lang = SUPPORTED.includes(nav) ? nav : 'en';
  await load(lang);
  apply();
  document.documentElement.lang = lang;
  return lang;
}

export async function load(next) {
  if (!SUPPORTED.includes(next)) next = 'en';
  const res = await fetch(`./locales/${next}.json`);
  dict = await res.json();
  // merge English for missing keys
  if (next !== 'en') {
    try {
      const en = await (await fetch('./locales/en.json')).json();
      dict = { ...en, ...dict };
    } catch { /* keep partial */ }
  }
  lang = next;
  if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, next);
}

export function setLanguage(next) {
  return load(next).then(() => {
    apply();
    document.documentElement.lang = lang;
    return lang;
  });
}

export function t(path) {
  const v = deepGet(dict, path);
  return typeof v === 'string' ? v : path;
}
