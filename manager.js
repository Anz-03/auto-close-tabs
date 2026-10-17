import { settingsFrom, planCleanup, eligible } from './policy.js';

// All entry points share one queue, including reads, settings changes and pinning.
export function createManager(api, now = Date.now) {
  let tail = Promise.resolve();
  const enqueue = task => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
  const getTabs = () => api.tabs.query({ windowType: 'normal' });

  async function snapshot(touchedId) {
    const [tabs, local, session] = await Promise.all([
      getTabs(), api.storage.local.get('settings'), api.storage.session.get('tracking'),
    ]);
    const settings = settingsFrom(local.settings);
    const tracking = session.tracking || { activity: {}, activeIds: [] };
    const time = now();
    const activity = {};
    for (const tab of tabs) {
      // Reset the idle clock when leaving a tab, even after a long reading session.
      activity[tab.id] = tab.active || tab.id === touchedId || tracking.activeIds.includes(tab.id)
        ? time : (tracking.activity[tab.id] ?? time);
    }
    await api.storage.session.set({ tracking: {
      activity, activeIds: tabs.filter(tab => tab.active).map(tab => tab.id),
    } });
    return { tabs, settings, activity, now: time };
  }

  async function clean(touchedId) {
    const state = await snapshot(touchedId);
    let closed = 0;
    for (const candidate of planCleanup(state.tabs, state.activity, state.settings, state.now)) {
      // Refresh before every removal: another window may have closed or pinned a tab.
      const current = await getTabs();
      const tab = current.find(item => item.id === candidate.id);
      if (current.length <= state.settings.maxTabs) break;
      if (!tab || !eligible(tab, state.activity, state.settings, now())) continue;
      try {
        await api.tabs.remove(tab.id);
        closed++;
      } catch (error) {
        // A tab may disappear between query and remove. Surface other failures.
        if ((await getTabs()).some(item => item.id === tab.id)) throw error;
      }
    }
    await api.action.setBadgeText({ text: state.settings.enabled ? '' : 'Ⅱ' });
    return { ...await snapshot(), closed };
  }

  return {
    run: touchedId => enqueue(() => clean(touchedId)),
    status: () => enqueue(() => snapshot()),
    save: value => enqueue(async () => {
      await api.storage.local.set({ settings: settingsFrom(value) });
      return clean();
    }),
    pin: (id, pinned) => enqueue(async () => {
      if (!Number.isInteger(id) || typeof pinned !== 'boolean') throw new Error('无效的标签参数');
      await api.tabs.update(id, { pinned });
      // Unpinning grants a fresh idle window.
      return clean(id);
    }),
  };
}
