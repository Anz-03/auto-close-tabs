export const DEFAULTS = Object.freeze({ enabled: true, maxTabs: 20, idleMinutes: 20, protectAudio: true });

export function settingsFrom(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const integer = (v, fallback, max) => Number.isInteger(v) && v >= 1 && v <= max ? v : fallback;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULTS.enabled,
    maxTabs: integer(value.maxTabs, DEFAULTS.maxTabs, 10000),
    idleMinutes: integer(value.idleMinutes, DEFAULTS.idleMinutes, 10080),
    protectAudio: typeof value.protectAudio === 'boolean' ? value.protectAudio : DEFAULTS.protectAudio,
  };
}

export function eligible(tab, activity, settings, now) {
  return !tab.pinned && !tab.active && !(settings.protectAudio && tab.audible)
    && Number.isFinite(activity[tab.id])
    && now - Math.max(activity[tab.id], tab.lastAccessed || 0) >= settings.idleMinutes * 60000;
}

const lastAccess = (tab, activity) => Math.max(activity[tab.id], tab.lastAccessed || 0);

export function planCleanup(tabs, activity, settings, now) {
  if (!settings.enabled || tabs.length <= settings.maxTabs) return [];
  return tabs.filter(tab => eligible(tab, activity, settings, now))
    .sort((a, b) => lastAccess(a, activity) - lastAccess(b, activity) || a.id - b.id)
    .slice(0, tabs.length - settings.maxTabs);
}
