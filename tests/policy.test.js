import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, settingsFrom, planCleanup } from '../policy.js';

const now = 100 * 60000;
const tab = (id, extra = {}) => ({ id, active: false, pinned: false, ...extra });
const settings = { ...DEFAULTS, maxTabs: 2 };

test('fixed tabs count toward cap but are never candidates; stop at cap in LRU order', () => {
  const tabs = [tab(1, { pinned: true }), tab(2), tab(3), tab(4), tab(5, { active: true })];
  const activity = { 1: 0, 2: 20 * 60000, 3: 10 * 60000, 4: 30 * 60000, 5: 0 };
  assert.deepEqual(planCleanup(tabs, activity, settings, now).map(t => t.id), [3, 2, 4]);
  assert.deepEqual(planCleanup(tabs, activity, { ...settings, maxTabs: 4 }, now).map(t => t.id), [3]);
});
test('below or exactly at cap never closes even very old tabs', () => {
  assert.deepEqual(planCleanup([tab(1), tab(2)], { 1: 0, 2: 0 }, settings, now), []);
});
test('no forced eviction when only recent, active, fixed or unknown tabs remain', () => {
  const tabs = [tab(1), tab(2, { pinned: true }), tab(3, { active: true }), tab(4)];
  assert.deepEqual(planCleanup(tabs, { 1: now - 19 * 60000, 2: 0, 3: 0 }, settings, now), []);
});
test('idle threshold boundary, dynamic threshold, and paused mode', () => {
  const tabs = [tab(1), tab(2), tab(3)];
  const activity = { 1: now - 20 * 60000, 2: now, 3: now };
  assert.equal(planCleanup(tabs, activity, settings, now).length, 1);
  assert.equal(planCleanup(tabs, activity, { ...settings, idleMinutes: 21 }, now).length, 0);
  assert.equal(planCleanup(tabs, activity, { ...settings, enabled: false }, now).length, 0);
});
test('audio protection is optional and recent browser access overrides stale tracking', () => {
  const tabs = [tab(1, { audible: true }), tab(2, { lastAccessed: now }), tab(3, { active: true })];
  const activity = { 1: 0, 2: 0, 3: 0 };
  assert.equal(planCleanup(tabs, activity, settings, now).length, 0);
  assert.deepEqual(planCleanup(tabs, activity, { ...settings, protectAudio: false }, now).map(t => t.id), [1]);
});
test('malformed persisted settings cannot produce an aggressive zero threshold', () => {
  assert.deepEqual(settingsFrom(null), DEFAULTS);
  assert.deepEqual(settingsFrom({ maxTabs: 0, idleMinutes: -1, enabled: 'yes', protectAudio: null }), DEFAULTS);
  assert.equal(settingsFrom({ maxTabs: 1, idleMinutes: 1 }).idleMinutes, 1);
});

test('LRU also respects newer native browser visit timestamps', () => {
  const tabs = [tab(1, { lastAccessed: 50 * 60000 }), tab(2), tab(3)];
  const activity = { 1: 0, 2: 10 * 60000, 3: 20 * 60000 };
  assert.deepEqual(planCleanup(tabs, activity, settings, now).map(t => t.id), [2]);
});
