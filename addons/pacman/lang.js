// @ts-check
// Language identity for vocabulary packs. A locale file is code-named (es.json / es.yaml) with no metadata
// inside it — Pacman owns the naming via a bundled copy of Weblate's language DB (languages.csv). It matches
// the file's code to a name, so LOCAL and REMOTE vocab both read the same regardless of what the index says;
// the catalog only needs the file to exist. code,name,nplurals,formula — codes use underscores (pt_BR).
/** @type {Map<string,string>|null} */
let LANG = null;
export async function loadLangs() {
  if (LANG) return;
  LANG = new Map();
  try {
    const txt = await fetch('/addons/pacman/languages.csv', { cache: 'force-cache' }).then((x) => x.text());
    for (const line of txt.split('\n').slice(1)) {
      const parts = line.split(',');
      if (parts.length < 4) continue;
      const code = parts[0].trim(), name = parts.slice(1, parts.length - 2).join(',').trim();
      if (code && name) LANG.set(code, name);
    }
  } catch (_) { /* no csv -> Intl fallback below */ }
}
// A locale code -> the ISO country code for its flag. A region subtag IS the country (pt-BR -> br); otherwise
// a few languages whose code isn't their country (en -> us, ...); else the code itself (es -> es, de -> de).
// Flags live in the addon (flags/<country>.svg), added per language as we go; a missing one just shows blank.
const LANG_COUNTRY = /** @type {Record<string,string>} */ ({ en: 'us', zh: 'cn', ja: 'jp', ko: 'kr', cs: 'cz', el: 'gr', uk: 'ua', vi: 'vn', ar: 'sa' });
/** @param {string} code */
function langCountry(code) {
  const region = /[-_]([A-Za-z]{2})$/.exec(code);
  if (region) return region[1].toLowerCase();
  return LANG_COUNTRY[code] || code.toLowerCase();
}
// Resolve a locale code (es, pt-BR, zh_Hans) to { name, description, icon(flag) }. CSV first (separator
// normalized), then the platform's own language names, then the bare code.
/** @param {string} code @returns {{name:string, description:string, icon:string}} */
export function langLabel(code) {
  let name = LANG && (LANG.get(code) || LANG.get(code.replace(/-/g, '_')) || LANG.get(code.replace(/_/g, '-')));
  if (!name) { try { const n = new Intl.DisplayNames(['en'], { type: 'language' }).of(code); if (n && n !== code) name = n; } catch (_) { /* not a tag */ } }
  name = name || code;
  return { name, description: name + ' vocabulary pack.', icon: '/addons/pacman/flags/' + langCountry(code) + '.svg' };
}
