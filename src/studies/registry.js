// @ts-check
// The study registry lives in the library (kapelka). The app re-exports it so the app and the
// library share ONE registry — studies registered via window.Studies land where the host reads them.
export { registerStudy, unregisterStudy, getStudy, listStudies, setRegisterHook, Studies } from '../../lib/kapelka/studies/registry.js';
