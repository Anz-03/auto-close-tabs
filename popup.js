import { planCleanup } from './policy.js';
const $ = id => document.getElementById(id);
let state;
let busy = false;
let initialized = false;

async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '无法连接后台，请在扩展管理页重新加载扩展');
  return response.state;
}
function notify(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}
function render(next, updateInputs = false) {
  state = next;
  const { tabs, settings, activity, now } = state;
  if (!initialized || updateInputs) {
    for (const key of ['maxTabs', 'idleMinutes']) $(key).value = settings[key];
    for (const key of ['enabled', 'protectAudio']) $(key).checked = settings[key];
    initialized = true;
  }
  const pinned = tabs.filter(tab => tab.pinned).length;
  const planned = new Set(planCleanup(tabs, activity, settings, now).map(tab => tab.id));
  $('total').textContent = tabs.length;
  $('limit').textContent = settings.maxTabs;
  $('progress').style.width = `${Math.min(100, tabs.length / settings.maxTabs * 100)}%`;
  $('badge').textContent = !settings.enabled ? '已暂停' : tabs.length > settings.maxTabs ? '等待闲置标签' : '空间刚刚好';
  $('summary').textContent = `${pinned} 个已固定 · ${tabs.length - pinned} 个未固定${planned.size ? ` · ${planned.size} 个待清理` : ''}`;
  $('tabs').replaceChildren();
  const sorted = [...tabs].sort((a, b) => Number(b.pinned) - Number(a.pinned) || activity[b.id] - activity[a.id]);
  for (const tab of sorted) {
    const row = document.createElement('div'); row.className = 'tab';
    const icon = document.createElement('span'); icon.className = 'tab-icon'; icon.textContent = tab.pinned ? '◈' : '▤';
    const text = document.createElement('div'); text.className = 'tab-text';
    const title = document.createElement('div'); title.className = 'tab-title'; title.textContent = tab.title || '未命名标签'; title.title = tab.title || '';
    const detail = document.createElement('div'); detail.className = 'tab-detail';
    detail.textContent = tab.pinned ? '固定保留' : tab.active ? '当前选中 · 保留' : tab.audible && settings.protectAudio ? '播放声音 · 保留' : `闲置 ${Math.max(0, Math.floor((now - activity[tab.id]) / 60000))} 分钟${planned.has(tab.id) ? ' · 待清理' : ''}`;
    text.append(title, detail);
    const button = document.createElement('button'); button.type = 'button'; button.className = `pin${tab.pinned ? ' pinned' : ''}`; button.textContent = tab.pinned ? '已固定' : '固定'; button.setAttribute('aria-label', `${tab.pinned ? '取消固定' : '固定'} ${tab.title || '标签'}`); button.setAttribute('aria-pressed', String(tab.pinned));
    button.addEventListener('click', () => action(async () => { render(await request({ type: 'pin', id: tab.id, pinned: !tab.pinned })); notify(tab.pinned ? '已取消固定，重新开始闲置计时' : '已固定，将豁免自动清理'); }));
    row.append(icon, text, button); $('tabs').append(row);
  }
}
async function action(task) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
  try { await task(); } catch (error) { notify(error.message, true); }
  finally { busy = false; document.querySelectorAll('button, input').forEach(el => { el.disabled = false; }); }
}
$('settings').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    const next = await request({ type: 'save', settings: {
      enabled: $('enabled').checked, protectAudio: $('protectAudio').checked,
      maxTabs: Number($('maxTabs').value), idleMinutes: Number($('idleMinutes').value),
    } });
    render(next, true); notify(`规则已生效${next.closed ? `，已清理 ${next.closed} 个标签` : ''}`);
  });
});
$('enabled').addEventListener('change', () => action(async () => {
  if (!state) return;
  const enabled = $('enabled').checked;
  try {
    const next = await request({ type: 'save', settings: { ...state.settings, enabled } });
    render(next); notify(enabled ? `已启用自动清理${next.closed ? `，已清理 ${next.closed} 个标签` : ''}` : '已暂停自动清理');
  } catch (error) { $('enabled').checked = state.settings.enabled; throw error; }
}));
$('clean').addEventListener('click', () => action(async () => {
  const next = await request({ type: 'clean' }); render(next);
  notify(!next.settings.enabled ? '自动清理已暂停，请先启用' : next.closed ? `已清理 ${next.closed} 个闲置标签` : '检查完成，目前没有需要清理的标签');
}));
await action(async () => render(await request({ type: 'status' })));
setInterval(async () => {
  if (busy) return;
  await action(async () => render(await request({ type: 'status' })));
}, 10000);
