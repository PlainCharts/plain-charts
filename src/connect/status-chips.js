// @ts-check
// Top-bar connection chips: a chip (green dot + account name) per CONNECTED account, re-rendered on every
// connection change; nothing listed when not connected to anything. App-lifetime — lives in the top strip,
// independent of the Connections dialog (which has its own list and its own subscription).
import { broker, bus } from '../../data_engine/index.js';
import { $ } from '../dom.js';

export function initConnStatusChips() {
  const renderTopStatus = () => {
    const c = $('conn'); if (!c) return;
    c.innerHTML = '';
    broker.connections().filter((x) => x.connected).forEach((x) => {
      const chip = document.createElement('span'); chip.className = 'conn-chip';
      const dot = document.createElement('span'); dot.className = 'conn-chip-dot';
      chip.append(dot, document.createTextNode(x.name));
      c.appendChild(chip);
    });
  };
  bus.on('connections:changed', renderTopStatus);
  renderTopStatus();
}
