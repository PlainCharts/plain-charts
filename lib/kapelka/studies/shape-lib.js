// @ts-check
// The shape library: named, reusable shape RECIPES. A recipe turns instance params into marks, so a
// shape is either a shareable DATASET (a data template with $param binding) or a CODE function
// (params -> marks). Registered shapes are placed by name from the shapes channel:
//   { shape: 'ob-box', from, to, top, bottom, color }
// which the host resolves through here into marks and hands to the one mark primitive (the ether).
//
// This is one more registry alongside studies / custom-plots / tools / vocab — user-defined,
// composable, shareable. A menu of shapes is just a folder of these recipes.

/** @type {Record<string, any>} shape recipes: a data template or a (params -> marks) function -- open bags */
const SHAPES = {};

/** @param {string} name @param {any} def */
export function registerShape(name, def) {
  if (name && def) SHAPES[name] = def;
}
/** @param {string} name */
export function unregisterShape(name) {
  delete SHAPES[name];
}
/** @param {string} name @returns {any} */
export function getShape(name) {
  return SHAPES[name] || null;
}
/** @returns {string[]} */
export function listShapes() {
  return Object.keys(SHAPES);
}

// Resolve a placement { shape:'name', ...params } -> marks[].
// `ctx` is reserved for L3 data-anchoring (chart-data functions like close($t)); today recipes get
// their values from params, so studies compute + pass what they need.
/** @param {any} instance a placement bag { shape, ...params } @param {any} [ctx] @returns {any[]} */
export function resolveShape(instance, ctx) {
  if (!instance || !instance.shape) return [];
  const def = SHAPES[instance.shape];
  if (!def) return [];
  if (typeof def === 'function') {
    // code recipe: params -> marks[]
    try {
      const out = def(instance, ctx);
      return Array.isArray(out) ? out.filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }
  // data recipe: { params: {defaults}, marks: [template] }
  const params = { ...(def.params || {}), ...instance };
  /** @type {any[]} */
  const marks = Array.isArray(def.marks) ? def.marks : [];
  try {
    return marks.map((mk) => bind(mk, params, ctx)).filter((mk) => mk != null);
  } catch (_) {
    return [];
  }
}

// The binding grammar. L1 (substitution) + literals, recursive:
//   "$name"  -> params[name]        (substitute)
//   "=expr"  -> evaluate            (L2/L4 arithmetic + conditionals -- lands in phase 2b)
//   else     -> literal (numbers, plain strings, nested objects/arrays resolved element-wise)
/** @param {any} v @param {any} params @param {any} ctx @returns {any} */
function bind(v, params, ctx) {
  if (typeof v === 'string') {
    if (v[0] === '$') return params[v.slice(1)];
    if (v[0] === '=') return evalExpr(v.slice(1), params, ctx);
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => bind(x, params, ctx));
  if (v && typeof v === 'object') {
    const o = /** @type {Record<string, any>} */ ({});
    for (const k in v) o[k] = bind(v[k], params, ctx);
    return o;
  }
  return v;
}

// "=expr" evaluation (L2 arithmetic + L4 conditionals). A tiny SAFE expression language -- no eval, no
// Function. Supports: numbers, 'strings', true/false/null, $params, fn(args) (ctx calls, reserved for
// L3 data-anchoring), unary ! - +, * / %, + -, < > <= >=, == != (strict), && ||, and ternary ?:.
// Each source string compiles once (cached) to a closure over { params, ctx }, re-evaluated per use.
const OPS2 = ['==', '!=', '<=', '>=', '&&', '||'];
const OPS3 = ['===', '!=='];

/** @param {string} src @returns {any[]} token bags { t, v } */
function tokenize(src) {
  /** @type {any[]} */
  const out = [];
  let i = 0;
  const n = src.length;
  /** @param {string} c */
  const idc = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_';
  /** @param {string} c */
  const ids = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
  /** @param {string} c */
  const dig = (c) => c >= '0' && c <= '9';
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
      continue;
    }
    if (dig(c) || (c === '.' && dig(src[i + 1]))) {
      let j = i + 1;
      while (j < n && (dig(src[j]) || src[j] === '.')) j++;
      out.push({ t: 'v', v: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1,
        s = '';
      while (j < n && src[j] !== c) {
        s += src[j];
        j++;
      }
      out.push({ t: 'v', v: s });
      i = j + 1;
      continue;
    }
    if (c === '$') {
      let j = i + 1;
      while (j < n && idc(src[j])) j++;
      out.push({ t: 'p', v: src.slice(i + 1, j) });
      i = j;
      continue;
    }
    if (ids(c)) {
      let j = i + 1;
      while (j < n && idc(src[j])) j++;
      const w = src.slice(i, j);
      i = j;
      out.push(
        w === 'true'
          ? { t: 'v', v: true }
          : w === 'false'
            ? { t: 'v', v: false }
            : w === 'null'
              ? { t: 'v', v: null }
              : { t: 'id', v: w },
      );
      continue;
    }
    const c3 = src.substr(i, 3);
    if (OPS3.indexOf(c3) >= 0) {
      out.push({ t: 'o', v: c3 });
      i += 3;
      continue;
    }
    const c2 = src.substr(i, 2);
    if (OPS2.indexOf(c2) >= 0) {
      out.push({ t: 'o', v: c2 });
      i += 2;
      continue;
    }
    if ('+-*/%<>!(),?:'.indexOf(c) >= 0) {
      out.push({ t: 'o', v: c });
      i++;
      continue;
    }
    throw 0;
  }
  return out;
}

/** @typedef {(s: any) => any} EvalFn  a compiled expression node: state { params, ctx } -> value */
/** @param {any[]} toks @returns {EvalFn} */
function parse(toks) {
  let i = 0;
  const peek = () => toks[i];
  /** @param {string} v */
  const iso = (v) => {
    const t = toks[i];
    return !!t && t.t === 'o' && t.v === v;
  };
  /** @param {string} v */
  const eat = (v) => {
    if (!iso(v)) throw 0;
    i++;
  };
  /** @returns {EvalFn} */
  const ternary = () => {
    const c = or();
    if (iso('?')) {
      i++;
      const a = ternary();
      eat(':');
      const b = ternary();
      return (s) => (c(s) ? a(s) : b(s));
    }
    return c;
  };
  /** @returns {EvalFn} */
  const or = () => {
    let l = and();
    while (iso('||')) {
      i++;
      const r = and(),
        L = l;
      l = (s) => L(s) || r(s);
    }
    return l;
  };
  /** @returns {EvalFn} */
  const and = () => {
    let l = eq();
    while (iso('&&')) {
      i++;
      const r = eq(),
        L = l;
      l = (s) => L(s) && r(s);
    }
    return l;
  };
  /** @returns {EvalFn} */
  const eq = () => {
    let l = rel();
    for (;;) {
      const t = peek();
      if (t && t.t === 'o' && (t.v === '==' || t.v === '!=' || t.v === '===' || t.v === '!==')) {
        i++;
        const r = rel(),
          L = l,
          e = t.v[0] === '=';
        l = (s) => (e ? L(s) === r(s) : L(s) !== r(s));
      } else break;
    }
    return l;
  };
  /** @returns {EvalFn} */
  const rel = () => {
    let l = add();
    for (;;) {
      const t = peek();
      if (t && t.t === 'o' && (t.v === '<' || t.v === '>' || t.v === '<=' || t.v === '>=')) {
        i++;
        const r = add(),
          L = l,
          o = t.v;
        l = (s) => (o === '<' ? L(s) < r(s) : o === '>' ? L(s) > r(s) : o === '<=' ? L(s) <= r(s) : L(s) >= r(s));
      } else break;
    }
    return l;
  };
  /** @returns {EvalFn} */
  const add = () => {
    let l = mul();
    for (;;) {
      const t = peek();
      if (t && t.t === 'o' && (t.v === '+' || t.v === '-')) {
        i++;
        const r = mul(),
          L = l,
          o = t.v;
        l = (s) => (o === '+' ? L(s) + r(s) : L(s) - r(s));
      } else break;
    }
    return l;
  };
  /** @returns {EvalFn} */
  const mul = () => {
    let l = un();
    for (;;) {
      const t = peek();
      if (t && t.t === 'o' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        i++;
        const r = un(),
          L = l,
          o = t.v;
        l = (s) => (o === '*' ? L(s) * r(s) : o === '/' ? L(s) / r(s) : L(s) % r(s));
      } else break;
    }
    return l;
  };
  /** @returns {EvalFn} */
  const un = () => {
    const t = peek();
    if (t && t.t === 'o' && (t.v === '!' || t.v === '-' || t.v === '+')) {
      i++;
      const e = un(),
        o = t.v;
      return (s) => (o === '!' ? !e(s) : o === '-' ? -e(s) : +e(s));
    }
    return prim();
  };
  /** @returns {EvalFn} */
  const prim = () => {
    const t = peek();
    if (!t) throw 0;
    if (t.t === 'v') {
      i++;
      const v = t.v;
      return () => v;
    }
    if (t.t === 'p') {
      i++;
      const nm = t.v;
      return (s) => (s.params ? s.params[nm] : undefined);
    }
    if (t.t === 'id') {
      i++;
      const nm = t.v;
      if (iso('(')) {
        i++;
        const args = /** @type {EvalFn[]} */ ([]);
        if (!iso(')')) {
          args.push(ternary());
          while (iso(',')) {
            i++;
            args.push(ternary());
          }
        }
        eat(')');
        return (s) => {
          const f = s.ctx && s.ctx[nm];
          return typeof f === 'function'
            ? f.apply(
                null,
                args.map((a) => a(s)),
              )
            : undefined;
        };
      }
      return (s) => (s.ctx ? s.ctx[nm] : undefined);
    }
    if (iso('(')) {
      i++;
      const e = ternary();
      eat(')');
      return e;
    }
    throw 0;
  };
  const node = ternary();
  if (i < toks.length) throw 0;
  return node;
}

/** @type {Map<string, EvalFn>} */
const _exprCache = new Map();
/** @param {string} src @param {any} params @param {any} ctx @returns {any} */
function evalExpr(src, params, ctx) {
  let fn = _exprCache.get(src);
  if (!fn) {
    try {
      fn = parse(tokenize(src));
    } catch (_) {
      fn = () => undefined;
    }
    _exprCache.set(src, fn);
  }
  return fn({ params, ctx });
}
