// @ts-check
// ORDER-WORKER boot entry. Import this in the order-host window (?role=orders). Joins the data
// bridge as a proxy consumer (reads the authoritative book, forwards low-level order verbs to the
// data-host) and runs the Order Worker -- the single owner of all order BUSINESS LOGIC. The app
// installs its assistant-order policy separately (setExecGate via the public index).
import './data/broker.js';    // proxy role: the book + low-level order verbs via the existing bridge
import './orders/host.js';    // the Order Worker runtime
