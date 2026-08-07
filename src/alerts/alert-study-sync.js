// @ts-check
// Alert <-> STUDY integration -- the drawings-sync analog for study instances. A series alert binds to an
// attached study by its instance uid (extent.studyUid / row.suid); the chart window, which owns the study
// host, re-snapshots bound alerts whenever studies change (param edit through the settings dialog, a
// relink, ...): fresh params into the compiled terms, the chosen plot kept when it still exists, the row's
// display label refreshed from the live attachment (derived, never frozen), and the fired latch reset so
// the alert re-arms on the new line. Also answers "which alerts bind to this study" for the remove cascade.
// All mutation funnels through alertCommand (the single writer); this module only reads and reflects.
import { t } from '../i18n/i18n.js';
import { bus } from '../bus.js';
import { alertCommand } from './funnel.js';
import { alertMirror } from './store.js';
import { alertablePlots } from './alert-conditions.js';
import { studyLabel } from '../../lib/kapelka/skin/legend.js';
import { studyUrlFor } from '../studies/user-loader.js';

/** the alerts bound to a study INSTANCE (any term whose extent carries its uid). @param {string} uid */
export function alertsForStudy(uid) {
  if (!uid) return [];
  return alertMirror()
    .all()
    .filter((/** @type {any} */ a) =>
      (((a && a.compiled) || {}).terms || []).some(
        (/** @type {any} */ tm) => tm && tm.extent && tm.extent.studyUid === uid,
      ),
    );
}

/** @param {any} a  the live attachment @returns {string} its current display label */
function labelOf(a) {
  try {
    return studyLabel(a);
  } catch (_) {
    return (a.study && a.study.name) || 'Study';
  }
}

let _inited = false;
export function initAlertStudySync() {
  if (_inited) return;
  _inited = true;
  bus.on('studies:changed', (/** @type {any} */ pane) => {
    try {
      const attached = (pane && pane.studies && pane.studies.attached) || [];
      /** @type {Map<string, any>} */
      const byUid = new Map();
      for (const a of attached) if (/** @type {any} */ (a).uid) byUid.set(/** @type {any} */ (a).uid, a);
      if (!byUid.size) return;
      for (const rec of alertMirror().all()) {
        const terms = ((rec && rec.compiled) || {}).terms || [];
        if (!terms.some((/** @type {any} */ tm) => tm && tm.extent && byUid.has(tm.extent.studyUid))) continue;
        // rebuild every bound term's snapshot from the LIVE attachment; skip when nothing changed
        let changed = false;
        const newTerms = terms.map((/** @type {any} */ tm) => {
          const a = tm && tm.extent && byUid.get(tm.extent.studyUid);
          if (!a) return tm;
          const plots = alertablePlots(
            a.plotMeta && a.plotMeta.length ? a.plotMeta : typeof a.study.plots === 'function' ? a.study.plots() : [],
          );
          const plot = plots.some((p) => p.key === tm.extent.plot)
            ? tm.extent.plot
            : plots.length
              ? plots[0].key
              : tm.extent.plot;
          const ext = {
            ...tm.extent,
            studyId: a.study.id,
            studyUrl: studyUrlFor(a.study.id) || tm.extent.studyUrl,
            params: { ...a.params },
            plot,
          };
          if (JSON.stringify(ext) !== JSON.stringify(tm.extent)) changed = true;
          return { ...tm, extent: ext };
        });
        // refresh the rows' display labels from the live attachment (the sentence list derives from these)
        const rows = ((rec.conditions && rec.conditions.conditions) || []).map((/** @type {any} */ r) => {
          if (!r || !r.suid || !byUid.has(r.suid)) return r;
          const label = labelOf(byUid.get(r.suid));
          const side = r.left === t('Price') ? 'right' : 'left'; // the non-Price side is the study
          if (r[side] === label) return r;
          changed = true;
          return { ...r, [side]: label };
        });
        if (!changed) continue;
        alertCommand('update', {
          id: rec.id,
          patch: {
            compiled: { ...rec.compiled, terms: newTerms },
            conditions: { ...rec.conditions, conditions: rows },
            rt: {},
          },
        }).catch(() => {});
      }
    } catch (_) {}
  });
}
