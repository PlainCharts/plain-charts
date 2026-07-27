# Translations (`/locales`)

Official translations live here as **flat monolingual JSON, keyed by the source string** — the shape
[Weblate](https://weblate.org) reads natively and syncs through GitHub.

```json
{
  "Positions": "Posiciones",
  "Working order": "Orden en curso"
}
```

- One file per language: `en.json`, `es.json`, …
- `en.json` is the **source template** (an identity map: `"Positions": "Positions"`). It is generated,
  never hand-translated.
- The key is the exact English string passed to `t()` in the code. A translation only needs the keys
  it changes — anything missing falls back to the English literal at runtime.

This is **vocabulary control**, not only translation: the words on screen act on the trader, so a pack
is a per-key lever over the app's whole lexicon. A language file is one such pack; a user's personal
overrides are another.

## How the app uses these files

The server serves every `*.json` here (except `en.json`) as a selectable **vocabulary pack** on
`GET /api/vocab`, named from its language code (`es.json` → "Spanish (es)"; see `LOCALE_NAMES` in
`server/settings-api.js`). Pick one under **Settings → Vocabulary**. The runtime is `src/i18n/i18n.js`:
`t(s)` returns the active pack's word for `s`, else a module/addon word, else `s` itself.

These files are **read-only from the app** — Weblate and git own them. The app never writes here;
user-authored custom packs live under `settings/appearance/vocab/` instead.

## Weblate component settings

Point a Weblate component at this repo with:

| Field | Value |
| --- | --- |
| File format | `JSON file` (monolingual) |
| File mask | `locales/*.json` |
| Monolingual base language file | `locales/en.json` |
| Template for new translations | `locales/en.json` |
| Source language | `en` |

Weblate then discovers each language from its filename, writes edits back as commits, and opens PRs —
no server-side string database, the git files are the source of truth.

The `wlc` CLI reads a `.weblate` file at the repo root; add one once the Weblate project exists:

```ini
[weblate]
url = https://<your-weblate-host>/api/

[component "<project>/<component>"]
```

## Adding a language

1. Copy `en.json` to `<code>.json` (e.g. `fr.json`) and translate the values (keep the keys).
2. If the code isn't in `LOCALE_NAMES` (`server/settings-api.js`), add it for a friendly display name.
3. Restart the server (the locale list is read at request time, but a fresh file needs the process to
   see it) — the new pack appears under Settings → Vocabulary.

Normally Weblate does step 1 for you from the template.

## Addons carry their own translations

Addons are independent packages the user may not even have installed, so their words never live in this
app catalog. Each addon ships its OWN folder, the same shape as this one:

```
addons/<id>/
  index.js
  locales/
    en.json     # source template (generated)
    es.json     # a translation
```

The server (`addon-host.js`) reads that folder and hands the per-language maps to the client, which
merges the active language's words for every enabled addon and re-picks them whenever the language
changes. An addon keys its UI with `const t = api.t` and `t('Download image')`; uninstalling the addon
removes its folder, and its words go with it. A word an addon shares with the app (e.g. `Clear`) may sit
in both catalogs — that's fine, the app pack resolves it first at runtime.

Point a **separate Weblate component** at each addon (file mask `addons/<id>/locales/*.json`, same
settings as above) so each addon is translated on its own.

## Keeping `en.json` current — the extractor

`npm run i18n` runs `scripts/i18n-extract.js`, a **read-only** scanner (on source). It scans `src/` for
`t('…')` / `tr('…')` **string-literal** calls into this app `en.json`, and each `addons/<id>` into that
addon's own `en.json` (sorted, identity-mapped). It only ever adds keys — except it also **prunes** from
the app catalog any addon-owned key the app doesn't itself use (via `t()`/`tr()` or `data-i18n`), so an
addon's words never leak into the app catalog.

Two things it can't see, so add those keys to `en.json` by hand:

- **Variable-driven** labels — `t(opt.label)`, `t(row.name)` — the literal isn't in the call.
- **Static HTML** — elements tagged `data-i18n` / `data-i18n-title` / `data-i18n-ph` (localized by
  `localizeDom`); the key is the attribute value, not a `t()` call.

**Gotcha:** always pass a single string literal — `t('A B')`, never `t('A ' + 'B')`. At runtime `t()`
gets `'A B'`, but the scanner captures only `'A'`, so the key would never match.
