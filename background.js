import { createManager } from './manager.js';

const manager = createManager(chrome);
const report = error => console.error('Tab Tidy:', error);
const run = id => manager.run(id).catch(report);
const ALARM = 'tab-tidy-check';

async function ensureAlarm() {
  if (!await chrome.alarms.get(ALARM)) {
    await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  }
}

chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) run(); });
chrome.tabs.onActivated.addListener(info => run(info.tabId));
chrome.tabs.onCreated.addListener(tab => run(tab.id));
chrome.tabs.onRemoved.addListener(() => run());
chrome.tabs.onUpdated.addListener((id, change) => {
  if ('pinned' in change) run(id);
  else if ('audible' in change || change.status === 'complete') run();
});
chrome.tabs.onAttached.addListener(id => run(id));
chrome.tabs.onDetached.addListener(() => run());
chrome.tabs.onReplaced.addListener(id => run(id));
chrome.runtime.onStartup.addListener(() => { ensureAlarm().catch(report); run(); });
chrome.runtime.onInstalled.addListener(() => { ensureAlarm().catch(report); run(); });

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  let operation;
  switch (message?.type) {
    case 'status': operation = manager.status(); break;
    case 'clean': operation = manager.run(); break;
    case 'save': operation = manager.save(message.settings); break;
    case 'pin': operation = manager.pin(message.id, message.pinned); break;
    default: return false;
  }
  operation.then(state => respond({ ok: true, state }), error => respond({ ok: false, error: error.message }));
  return true;
});

// MV3 workers are disposable; recreate missing alarms on every worker start.
ensureAlarm().catch(report);
run();
