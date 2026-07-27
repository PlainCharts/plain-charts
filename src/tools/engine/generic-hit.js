// Generic hit-testing derived from a tool's marks. This is the payoff of the ether: a tool
// that describes its geometry as marks no longer has to hand-write hitTest — the same marks it
// DRAWS are resolved to screen paths and tested here. A drawing becomes a pure recipe (geometry +
// anchors); selecting/reshaping it is inferred, not coded per tool.
//
// Two parts, matching the per-tool hitTest contract exactly:
//   points -> { part:'point', index }   the reshape handles (anchors), tested first
//   body   -> { part:'body' }           any mark path: inside a closed fill, or near any edge
// @ts-check
import { resolveVertex } from '../../../lib/kapelka/studies/primitives/marks.js';
import { geom } from './geometry.js';

/** @typedef {import('./geometry.js').ScreenPoint} ScreenPoint */
// A tool: opaque plug module (marks/handles/etc.), untyped at this boundary.
/** @typedef {any} Tool */
// A drawing object handed to hit-testing (only its recipe is read here).
/** @typedef {any} Drawing */
// The render view (data<->screen mappers + plot size) the tool's marks() expects.
/** @typedef {{ timeToX: (t: number) => number|null, priceToY: (p: number) => number|null, width: number, height: number, snapX?: (x: number) => number }} HitView */
// A resolved-geometry vertex in screen space.
/** @typedef {{ x: number, y: number }} Vertex */

// ray-cast point-in-polygon (for filled/closed marks — click anywhere inside selects the body)
/** @param {number} x @param {number} y @param {Vertex[]} poly @returns {boolean} */
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// Hit-test a marks-based tool. `pts` are the drawing's anchor points in screen space (same as a
// per-tool hitTest receives); `view` is the render view (timeToX/priceToY/width/height/...) so the
// tool's marks resolve to the SAME pixels the renderer painted.
/**
 * @param {Tool} tool @param {Drawing} d @param {ScreenPoint[]} pts
 * @param {number} x @param {number} y @param {number} tol @param {HitView} view
 * @returns {{ part: 'point', index: number } | { part: 'body' } | null}
 */
export function hitTestFromMarks(tool, d, pts, x, y, tol, view) {
  // 1. anchors first — the handles a tool exposes (default: its points), so a click on a
  //    handle reshapes rather than selecting the body. Index maps back to d.points.
  const hs = typeof tool.handles === 'function' ? (tool.handles(pts, d) || pts) : pts;
  for (let i = 0; i < hs.length; i++)
    if (hs[i] && geom.dist(x, y, hs[i].x, hs[i].y) <= tol + 3) return { part: 'point', index: i };

  // 2. body — resolve the marks this tool draws and test the click against their geometry.
  const scope = { timeToX: view.timeToX, priceToY: view.priceToY, width: view.width, height: view.height };
  let marks; try { marks = tool.marks(d, view, false) || []; } catch (_) { marks = []; }
  for (const m of marks) {
    if (!m || !m.path || m.path.length < 1) continue;
    const poly = [];
    let ok = true;
    for (const v of m.path) { const q = resolveVertex(v, scope); if (!q) { ok = false; break; } poly.push(q); }
    if (!ok || !poly.length) continue;
    // filled closed shape: inside counts as body
    if (m.closed && m.fill && poly.length >= 3 && pointInPoly(x, y, poly)) return { part: 'body' };
    // near any edge (covers open strokes and the outline of closed shapes)
    const w = (m.width || 1) / 2;
    for (let i = 1; i < poly.length; i++)
      if (geom.distToSegment(x, y, poly[i - 1].x, poly[i - 1].y, poly[i].x, poly[i].y) <= tol + w) return { part: 'body' };
    if (m.closed && poly.length >= 2 &&
        geom.distToSegment(x, y, poly[poly.length - 1].x, poly[poly.length - 1].y, poly[0].x, poly[0].y) <= tol + w)
      return { part: 'body' };
  }
  return null;
}
