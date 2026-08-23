# Contributing to SheetBound

Thanks for your interest! SheetBound is a zero-dependency, client-only app —
no build step, no framework, no backend.

## Ground rules

- **No runtime dependencies.** Vanilla ES modules only.
- **Business logic lives in `js/logic.js`** and must stay DOM-free so `node --test` can exercise it.
- **Every PR adds or updates tests** (`tests/*.test.js`, `node --test tests/*.test.js`).
- **i18n:** user-facing strings go through `/locales/en.json` + `pt-BR.json` with a `data-i18n` attribute. Never hardcode copy in markup.

## Local workflow

```bash
git clone https://github.com/chr-z/sheetbound.git && cd sheetbound
node --test tests/*.test.js   # green before you touch anything
npm run serve                  # http://localhost:8080
```

## Print changes

If you touch the sheet layout, verify with **Print preview** on both A4 and
Letter before opening the PR — the print stylesheet in `css/style.css`
(`@media print`) is load-bearing.

## Commits

Small, imperative subjects (`Add OSR level cap validation`). CI runs tests on
every push; Pages deploys from `main` after a green test run.
