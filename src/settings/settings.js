// @ts-check
// settings/settings.json — app preferences (timeframes, current layout, sync,
// auto-connect). Named layouts live separately in layouts.json (saved-layouts.js).
import { createStore } from '../store.js';

const store = createStore('/api/settings', {
  intervals: [], favoriteTimeframes: [], layout: '1', panes: [],
  syncSymbol: true, syncInterval: false, syncCrosshair: false, autoConnect: false,
});

export const loadSettings = () => store.load();
export const getSetting = store.get;
export const setSetting = store.set;
