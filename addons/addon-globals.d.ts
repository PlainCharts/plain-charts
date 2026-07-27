// Ambient declarations for the addon runtime environment. Addons are CommonJS modules
// (`module.exports = { ui, start, stop }`) loaded by the addon host (Node `require`) and by the
// browser (an `eval` wrapper that provides `module`/`exports`/`require`). This declares those
// loader-provided globals so `tsc` can type-check the addon files. TYPE-ONLY — never shipped, no
// runtime effect.
declare var module: { exports: any };
declare var exports: any;
declare function require(id: string): any;
