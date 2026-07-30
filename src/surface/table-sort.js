// @ts-check
// Shared column-sort state for the configurable surface tables (Orders, Positions, History, Accounts).
// One comparator rule for all of them: numeric when both raw values parse as numbers, else string compare;
// blanks always sink to the bottom regardless of direction. Clicking the active column flips direction; a
// new column starts descending. The choice persists per table under its own setting key.
import { getSetting, setSetting } from '../settings/settings.js';

/**
 * @param {{ settingKey: string, defaultKey: string, defaultDir?: 'asc'|'desc',
 *   valueOf: (key: string, row: any) => any, onChange: () => void }} opts
 *   valueOf = the table's RAW accessor lookup (undefined for an unknown key -> rows compare equal);
 *   onChange = re-render after a header click.
 */
export function createTableSort({ settingKey, defaultKey, defaultDir = 'desc', valueOf, onChange }) {
  const saved = getSetting(settingKey) || {};
  let sortKey = saved.key || defaultKey;
  /** @type {'asc'|'desc'} */
  let sortDir = saved.dir === 'asc' || saved.dir === 'desc' ? saved.dir : defaultDir;

  /** @param {any} a @param {any} b @returns {number} */
  const compare = (a, b) => {
    const av = valueOf(sortKey, a),
      bv = valueOf(sortKey, b);
    const ae = av == null || av === '',
      be = bv == null || bv === '';
    if (ae && be) return 0;
    if (ae) return 1;
    if (be) return -1; // blanks last regardless of direction
    const na = Number(av),
      nb = Number(bv);
    const r = !Number.isNaN(na) && !Number.isNaN(nb) ? na - nb : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? r : -r;
  };
  /** @param {string} k */
  const setSort = (k) => {
    if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else {
      sortKey = k;
      sortDir = 'desc';
    }
    setSetting(settingKey, { key: sortKey, dir: sortDir });
    onChange();
  };
  // the header arrow for column k -- an element when k is the active sort, else null
  /** @param {string} k @returns {HTMLElement|null} */
  const arrowFor = (k) => {
    if (k !== sortKey) return null;
    const ar = document.createElement('span');
    ar.className = 'sort-arrow';
    ar.textContent = sortDir === 'asc' ? ' ↑' : ' ↓';
    return ar;
  };

  return { compare, setSort, arrowFor };
}
