// @ts-check
// The engine's trading DSL -- the PARSER half (pure). A script is a sentence; `and` / `,` / `;` / newline
// chain steps. The EXECUTOR (order business logic) lives in exec.js and runs in the order-host worker;
// parseScript here is pure and shared for client-side validation (the order-ticket button editor) and for
// the worker. Vocabulary:
//   buy <qty>            sell <qty>            market order on the dialog's symbol
//   buy stake <$>        sell stake <$>        market order SIZED BY RISK: the qty is computed so ~$N is lost if the
//                                              stop is hit. Needs a "set stop" in the same script (the risk basis).
//   buy                  sell                  (bare, no qty) a TRIGGER: fire the order ticket's active tab as set up,
//                                              same as clicking its Buy/Sell button. UI-only (needs the ticket form).
//   set stop <n>                               SET the protective stop n away from ENTRY (UNIT-AGNOSTIC: pips on forex,
//   set target <n>  (alias: tp)                pts on index; pips|points overrides). FOLLOWING a buy/sell it brackets
//                                              the new entry; standalone it places/moves the stop to n-from-entry.
//   move stop be [+/-n]                        MOVE the existing stop to break-even (stop = entry). Optional buffer
//                                              +n locks n in the profit direction (entry+n long / entry-n short); -n gives n of room.
//   move stop <n>                              nudge the existing stop n (pips/pts) toward entry (and beyond -> profit lock).
//   close all/symbol/buy/sell/partial <n>      close family (account-type aware: hedging closes lots by ticket;
//                                              netting reduces the net with an opposing market order). partial N = N
//                                              lots/contracts/shares off the CURRENT position; several -> open the ticket.

/**
 * Parse a script into an ordered op-list. Throws Error(message) on the first bad clause. PURE -- no side effects,
 * so both the client (validation) and the worker (execution) call it.
 * @param {string} text @returns {any[]}
 */
export function parseScript(text) {
  const clauses = String(text || '').toLowerCase().split(/\band\b|,|;|\n/).map((s) => s.trim()).filter(Boolean);
  /** @type {any[]} */
  const ops = [];
  for (const c of clauses) {
    const w = c.split(/\s+/);
    if (w[0] === 'buy' || w[0] === 'sell') {
      // bare "buy"/"sell" -- a TRIGGER: fire the order ticket's ACTIVE tab exactly as set up (same as its Buy/Sell button).
      // Resolved by the ticket UI (which holds the form values); a headless run (alert/assistant) has no tab and errors.
      if (w.length === 1) {
        ops.push({ op: 'market', side: w[0], trigger: true });
      } else if (w[1] === 'stake') {
        const stake = Number(w[2]);
        if (!(stake > 0)) throw new Error('"' + c + '": expected a stake amount, e.g. "' + w[0] + ' stake 100"');
        ops.push({ op: 'market', side: w[0], stake });
      } else {
        const qty = Number(w[1]);
        if (!(qty > 0)) throw new Error('"' + c + '": expected a quantity, e.g. "' + w[0] + ' 5" (or a risk amount: "' + w[0] + ' stake 100")');
        ops.push({ op: 'market', side: w[0], qty });
      }
    } else if (w[0] === 'set') {
      // SET = place a protective level at an absolute distance from entry (stop below / target above). N only.
      const kind = w[1] === 'stop' ? 'setStop' : (w[1] === 'target' || w[1] === 'tp') ? 'setTarget' : null;
      if (!kind) throw new Error('"' + c + '": set what? use "set stop N" or "set target N" (to reposition a stop, use "move stop be" / "move stop N%")');
      const value = Number(w[2]);
      if (!(value > 0)) throw new Error('"' + c + '": expected a distance, e.g. "set ' + (kind === 'setStop' ? 'stop 20' : 'target 40') + '" (to reposition, use "move stop be" / "move stop N")');
      const unit = (w[3] === 'pips' || w[3] === 'points') ? w[3] : undefined;
      ops.push({ op: kind, mode: 'dist', value, unit });
    } else if (w[0] === 'move') {
      // MOVE = reposition the EXISTING stop: be [+/-N] (to entry, optional buffer) or N% (trail toward entry).
      if (w[1] !== 'stop') throw new Error('"' + c + '": move what? use "move stop be" or "move stop N%"');
      const arg = w[2];
      if (arg === 'be') {
        // optional buffer "+N" / "-N" -- N in the PROFIT direction from entry (locks N; "-N" gives N of room)
        let buffer = 0, unit;
        const rest = w.slice(3);
        if (rest.length) {
          let sign, numTok, u;
          if (/^[+-]\d/.test(rest[0])) { sign = rest[0][0]; numTok = rest[0].slice(1); u = rest[1]; }
          else if (rest[0] === '+' || rest[0] === '-') { sign = rest[0]; numTok = rest[1]; u = rest[2]; }
          else throw new Error('"' + c + '": buffer must be +N or -N, e.g. "move stop be +2"');
          const n = Number(numTok);
          if (!(n > 0)) throw new Error('"' + c + '": expected a buffer amount, e.g. "move stop be +2"');
          buffer = (sign === '-' ? -1 : 1) * n;
          unit = (u === 'pips' || u === 'points') ? u : undefined;
        }
        ops.push({ op: 'moveStop', mode: 'be', buffer, unit });
      } else if (/^\d+(\.\d+)?$/.test(arg || '')) { const n = Number(arg); const unit = (w[3] === 'pips' || w[3] === 'points') ? w[3] : undefined; ops.push({ op: 'moveStop', mode: 'by', value: n, unit }); }   // move the stop N toward entry
      else throw new Error('"' + c + '": move stop needs "be [+/-N]" or "N", e.g. "move stop 5" or "move stop be +2"');
    } else if (w[0] === 'close') {
      const what = w[1];
      if (what === 'all' || what === 'symbol' || what === 'buy' || what === 'sell') ops.push({ op: 'close', what });
      else if (what === 'partial') { const qty = Number(w[2]); if (!(qty > 0)) throw new Error('"' + c + '": close partial needs a quantity, e.g. "close partial 2"'); ops.push({ op: 'close', what: 'partial', qty }); }
      else throw new Error('"' + c + '": use close all | symbol | buy | sell | partial N');
    } else {
      throw new Error('"' + c + '": unknown command (buy, sell, set stop, set target, move stop, close all/symbol/buy/sell/partial)');
    }
  }
  if (!ops.length) throw new Error('empty script');
  validateSemantics(ops);   // cross-clause dependency checks -- surfaced in the editor before runtime (compiler-style)
  return ops;
}

// SEMANTIC validation: the per-clause parse above is pure syntax; these are cross-clause DEPENDENCIES the executor also
// enforces at runtime, lifted here so the button editor rejects a bad script at SAVE time (error under the box). A
// market op's "bracket" is the setStop/setTarget clauses that immediately follow it (same gathering rule as exec.js).
/** @param {any[]} ops */
function validateSemantics(ops) {
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.op === 'market') {
      /** @type {any[]} */ const brk = [];
      let j = i;
      while (j + 1 < ops.length && ((ops[j + 1].op === 'setStop' && ops[j + 1].mode === 'dist') || ops[j + 1].op === 'setTarget')) { brk.push(ops[j + 1]); j++; }
      // a STAKE order is sized from the stop -- it MUST have a "set stop" in its bracket (a target alone is not enough)
      if (Number(op.stake) > 0 && !brk.some((b) => b.op === 'setStop')) {
        throw new Error('"' + op.side + ' stake ' + op.stake + '" needs a stop -- add "set stop N" (the stop is the risk basis, e.g. "' + op.side + ' stake ' + op.stake + ' and set stop 20")');
      }
      i = j;   // the bracket clauses belong to this market -- skip them so a bracketed target is not flagged below
    } else if (op.op === 'setTarget') {
      // a target only makes sense on a fresh entry's bracket; a standalone one has nothing to attach to
      throw new Error('"set target" must follow a buy/sell in the same script (e.g. "buy 1 and set target 40")');
    }
  }
}
