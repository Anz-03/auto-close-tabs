import test from 'node:test';
import assert from 'node:assert/strict';
import { createManager } from '../manager.js';

function fixture() {
  let time = 100 * 60000;
  let tabs = [
    { id: 1, windowId: 1, active: true, pinned: false },
    { id: 2, windowId: 1, active: false, pinned: false },
    { id: 3, windowId: 2, active: true, pinned: false },
    { id: 4, windowId: 2, active: false, pinned: true },
  ];
  const removed = [];
  const local = { settings: { enabled: true, maxTabs: 3, idleMinutes: 20, protectAudio: true } };
  const session = {};
  let beforeQuery;
  const area = data => ({
    get: async key => structuredClone({ [key]: data[key] }),
    set: async values => Object.assign(data, structuredClone(values)),
  });
  const api = {
    storage: { local: area(local), session: area(session) },
    tabs: {
      query: async () => { beforeQuery?.(); return structuredClone(tabs); },
      update: async (id, change) => Object.assign(tabs.find(t => t.id === id), change),
      remove: async id => { removed.push(id); tabs = tabs.filter(t => t.id !== id); },
    },
    action: { setBadgeText: async () => {} },
  };
  return { api, local, session, removed, manager: createManager(api, () => time),
    advance: minutes => { time += minutes * 60000; },
    tabs: () => tabs, setBeforeQuery: fn => { beforeQuery = fn; } };
}

test('initial grace, multiple windows, idle cleanup and session pruning', async () => {
  const f = fixture();
  assert.equal((await f.manager.run()).closed, 0);
  f.advance(20);
  assert.equal((await f.manager.run()).closed, 1);
  assert.deepEqual(f.removed, [2]);
  assert.equal(f.session.tracking.activity[2], undefined);
  assert.equal(f.tabs().length, 3);
});
test('leaving a long-active tab starts a fresh idle window', async () => {
  const f = fixture();
  await f.manager.run();
  f.advance(90);
  f.tabs()[0].active = false;
  f.tabs()[1].active = true;
  await f.manager.run(2);
  assert.equal(f.removed.length, 0);
  f.advance(19);
  await f.manager.run();
  assert.equal(f.removed.length, 0);
  f.advance(1);
  await f.manager.run();
  assert.deepEqual(f.removed, [1]);
});
test('worker recreation keeps tracking; browser-session reset grants grace', async () => {
  const f = fixture();
  await f.manager.run();
  f.advance(20);
  const restartedWorker = createManager(f.api, () => 120 * 60000);
  assert.equal((await restartedWorker.run()).closed, 1);
  const g = fixture();
  await g.manager.run();
  g.advance(60);
  delete g.session.tracking;
  assert.equal((await g.manager.run()).closed, 0);
});
test('queued cleanups cannot double-close; saving rules applies immediately', async () => {
  const f = fixture();
  await f.manager.run();
  f.advance(10);
  const saved = await f.manager.save({ ...f.local.settings, idleMinutes: 5 });
  assert.equal(saved.closed, 1);
  await Promise.all([f.manager.run(), f.manager.run()]);
  assert.deepEqual(f.removed, [2]);
});
test('unpinning grants fresh grace and paused cleanup does nothing', async () => {
  const f = fixture();
  await f.manager.run();
  await f.manager.save({ ...f.local.settings, enabled: false });
  f.advance(30);
  await f.manager.pin(4, false);
  assert.equal(f.removed.length, 0);
  const next = await f.manager.save({ ...f.local.settings, enabled: true });
  assert.equal(next.closed, 1);
  assert.deepEqual(f.removed, [2]);
  assert.ok(f.tabs().some(t => t.id === 4));
});
test('revalidate pinned status and total count before removal', async () => {
  const f = fixture();
  await f.manager.run();
  f.advance(30);
  let queries = 0;
  f.setBeforeQuery(() => { if (++queries === 2) f.tabs()[1].pinned = true; });
  assert.equal((await f.manager.run()).closed, 0);
  assert.deepEqual(f.removed, []);
});
test('revalidate a recently visited background tab before removal', async () => {
  const f = fixture();
  await f.manager.run();
  f.advance(30);
  let queries = 0;
  f.setBeforeQuery(() => { if (++queries === 2) f.tabs()[1].lastAccessed = 130 * 60000; });
  assert.equal((await f.manager.run()).closed, 0);
});
test('one failed removal surfaces an error without breaking the queue', async () => {
  const f = fixture();
  await f.manager.run();
  f.advance(30);
  const remove = f.api.tabs.remove;
  f.api.tabs.remove = async () => { throw new Error('browser refused'); };
  await assert.rejects(f.manager.run(), /browser refused/);
  f.api.tabs.remove = remove;
  assert.equal((await f.manager.run()).closed, 1);
});
