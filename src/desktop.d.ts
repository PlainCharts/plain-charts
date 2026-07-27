// Ambient type for the Electron preload's `window.desktop` bridge -- the fixed API the desktop shell
// injects into every renderer. Absent in plain-browser mode, so `desktop?` on Window; the app guards
// `if (desktop)` before use. Methods mirror the preload one-to-one. TYPE-ONLY -- never shipped.

interface DesktopDebugInfo { port: number; active: boolean; dev: boolean }

interface DesktopApi {
  isDesktop: boolean;

  // multi-window tab ownership (main assigns each window an ordered id list)
  addTab(id: string): void;
  removeTab(id: string): void;
  claim(ids: string[]): void;
  onTabs(cb: (ids: string[]) => void): void;

  // frameless-window controls (the tab strip is the title bar)
  winMinimize(): void;
  winMaximizeToggle(): void;
  winClose(): void;

  // tab drag-to-window: screen coords, main resolves the drop (new window vs dock)
  dragStart(id: string, pos: { x: number; y: number }): void;
  dragMove(pos: { x: number; y: number }): void;
  dragEnd(pos: { x: number; y: number }): void;

  // settings + dev
  setAutoRestore(on: boolean): void;
  devtools(on: boolean): void;

  // Optional -- probed with `if (desktop.x)` at the call sites because older preload builds may
  // predate them; TS must see them as maybe-absent so those existence checks stay meaningful.
  setActive?(id: string): void;
  onMaxChange?(cb: (isMax: boolean) => void): void;
  newWindow?(): void;
  openOrderTicket?(opts?: { tab?: string; position?: any; symbol?: string; broker?: string }): void;
  onOrderTicketOpen?(cb: (opts: { tab?: string; position?: any; symbol?: string; broker?: string }) => void): void;
  orderTicketReady?(): void;
  winIsAlwaysOnTop?(): boolean;
  winAlwaysOnTopToggle?(): boolean;
  appQuit?(): void;
  debugInfo?(): DesktopDebugInfo;
}

interface Window { desktop?: DesktopApi }
