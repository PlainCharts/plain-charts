// @ts-check
// The shared "Import…" flow (chart templates, chart themes, app themes): a hidden file input ->
// FileReader -> JSON.parse, with the one invalid-JSON alert. The caller validates the parsed document
// and applies it; returning false shows the caller's what-this-file-should-be message.
import { t } from '../i18n/i18n.js';

/**
 * @param {(doc: any) => boolean} apply  validate + apply the parsed JSON; false -> alert `wrongMsg`
 * @param {string} wrongMsg  shown when the file parses as JSON but isn't the expected document
 */
export function importJsonFile(apply, wrongMsg) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      let d;
      try {
        d = JSON.parse(/** @type {string} */ (r.result));
      } catch (_) {
        alert(t('That file is not valid JSON.'));
        return;
      }
      if (!apply(d)) alert(wrongMsg);
    };
    r.readAsText(f);
  };
  inp.click();
}
