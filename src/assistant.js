import { clone, validateProject } from './model.js';
import { sanitizeContent, exportHTML } from './content.js';
import { readStorage, writeStorage, download, readFile } from './storage.js';
import { AI_SETTINGS_KEY, normalizeAISettings, parseAIResponse, requestAI } from './ai.js';
import { WORKSPACE_KEY, createVersions, validateWorkspace, mergeProjects } from './versions.js';

const $ = id => document.getElementById(id);
const validate = value => validateProject(value, sanitizeContent);
export function createAssistant({ initial, getProject, restoreInitial, applyProject, finishGesture, notify, scheduleSave, startupWarning }) {
  let saved;
  try { saved = readStorage(WORKSPACE_KEY, value => validateWorkspace(value, validate)); }
  catch { startupWarning('版本或对话记录读取失败，已使用本地草稿'); }
  let versions = createVersions(initial, saved?.versions);
  if (saved) restoreInitial(versions.current);
  let messages = saved?.messages || [];
  let pending = saved?.pending || null;
  let settings = normalizeAISettings();
  let rememberKey = false;
  try { settings = readStorage(AI_SETTINGS_KEY, normalizeAISettings) || settings; rememberKey = !!settings.key; }
  catch { startupWarning('AI 设置读取失败，请重新配置'); }
  let controller = null;
  let choices = {};
  let mergeHead = null;
  const serialize = () => ({ version: 1, versions: versions.serialize(), messages: clone(messages), pending: clone(pending) });
  function setPanel(open) {
    $('aiPanel').hidden = !open;
    $('aiToggleBtn').setAttribute('aria-expanded', String(open));
  }
  function renderMessages() {
    $('aiMessages').replaceChildren();
    const visible = messages.length ? messages : [{ role: 'system', content: '先在设置中连接 AI，再描述客户需求。等待 AI 时可以继续编辑画布，返回后可合并修改。' }];
    for (const message of visible) {
      const node = document.createElement('div'); node.className = `ai-message ${message.role}`;
      const label = document.createElement('strong'); label.textContent = { user: '客户需求', assistant: 'AI 助手', system: '操作记录' }[message.role];
      const text = document.createElement('span'); text.textContent = message.content;
      node.append(label, text); $('aiMessages').append(node);
    }
    $('aiMessages').scrollTop = $('aiMessages').scrollHeight;
    $('aiPending').hidden = !pending;
    $('aiPendingSummary').textContent = pending?.summary || '';
    $('aiSendBtn').disabled = !!controller || !!pending;
    $('aiCancelBtn').hidden = !controller;
  }
  function addMessage(role, content) { messages.push({ role, content }); renderMessages(); scheduleSave(); }
  function renderVersions() {
    $('versionsList').replaceChildren();
    const entries = versions.entries;
    const numbers = new Map(entries.map((entry, index) => [entry.id, index + 1]));
    for (const entry of entries.toReversed()) {
      const row = document.createElement('div'); row.className = `version-row${entry.id === versions.head ? ' current' : ''}`;
      const info = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = `版本 ${numbers.get(entry.id)} · ${entry.label}${entry.id === versions.head ? ' · 当前' : ''}`;
      const meta = document.createElement('small'); meta.textContent = `${new Date(entry.createdAt).toLocaleString('zh-CN')} · ${entry.project.items.length} 个组件${entry.parent ? ` · 源于版本 ${numbers.get(entry.parent)}` : ''}${entry.mergeParent ? ` · 合并版本 ${numbers.get(entry.mergeParent)}` : ''}`;
      info.append(title, meta);
      const button = document.createElement('button'); button.className = 'btn btn-sm'; button.textContent = '回退到此版本'; button.disabled = entry.id === versions.head;
      button.addEventListener('click', () => {
        finishGesture();
        const value = versions.checkout(entry.id);
        applyProject(value, '版本回退'); renderVersions();
        addMessage('system', `已回退到版本 ${numbers.get(entry.id)}，原有分支继续保留。`);
        notify('已回退到所选版本，原有修改仍在版本记录中');
      });
      row.append(info, button); $('versionsList').append(row);
    }
  }
  function pendingMerge() {
    const entries = versions.entries;
    const base = entries.find(entry => entry.id === pending.baseId).project;
    const remote = entries.find(entry => entry.id === pending.aiId).project;
    return mergeProjects(base, getProject(), remote, choices);
  }
  const valueText = value => value === undefined ? '（已删除 / 不存在）' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  function renderMerge() {
    if (!pending) return;
    const result = pendingMerge();
    mergeHead = versions.head;
    $('mergeSummary').textContent = `${pending.summary} · ${result.conflicts.length ? `${result.conflicts.length} 项冲突需要选择` : '没有字段冲突，确认后应用合并结果'}`;
    $('mergeConflicts').replaceChildren();
    for (const conflict of result.conflicts) {
      const row = document.createElement('section'); row.className = 'merge-conflict';
      const title = document.createElement('strong'); title.textContent = conflict.path.join(' / ');
      const values = document.createElement('div'); values.className = 'merge-values';
      for (const [label, value] of [['请求时基准', conflict.base], ['当前本地', conflict.local], ['AI 修改', conflict.remote]]) {
        const column = document.createElement('div'); const heading = document.createElement('strong'); heading.textContent = label;
        const pre = document.createElement('pre'); pre.textContent = valueText(value); column.append(heading, pre); values.append(column);
      }
      const select = document.createElement('select'); select.setAttribute('aria-label', `${conflict.path.join(' / ')} 的合并选择`); select.dataset.conflict = conflict.key;
      for (const [value, text] of [['', '请选择保留内容'], ['local', '保留当前本地'], ['ai', '采用 AI 修改']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option); }
      select.value = choices[conflict.key] || '';
      select.addEventListener('change', () => { choices[conflict.key] = select.value; updateMergePreview(); });
      row.append(title, values, select); $('mergeConflicts').append(row);
    }
    updateMergePreview();
  }
  function updateMergePreview() {
    try {
      $('mergePreview').srcdoc = exportHTML(validate(pendingMerge().project));
      $('mergeError').textContent = '';
    } catch (error) { $('mergePreview').removeAttribute('srcdoc'); $('mergeError').textContent = `合并结果不可用：${error.message}`; }
  }
  function openMerge() {
    finishGesture(); choices = {}; renderMerge();
    if (!$('mergeDialog').open) $('mergeDialog').showModal();
  }
  $('aiToggleBtn').addEventListener('click', () => setPanel($('aiPanel').hidden));
  $('aiCloseBtn').addEventListener('click', () => setPanel(false));
  $('settingsBtn').addEventListener('click', () => {
    $('aiURL').value = settings.url; $('aiKey').value = settings.key; $('aiModel').value = settings.model;
    $('aiRememberKey').checked = rememberKey;
    $('aiSettingsError').textContent = ''; $('settingsDialog').showModal();
  });
  $('aiSettingsForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const next = normalizeAISettings({ url: $('aiURL').value, key: $('aiKey').value, model: $('aiModel').value });
      writeStorage(AI_SETTINGS_KEY, { ...next, key: $('aiRememberKey').checked ? next.key : '' });
      settings = next; rememberKey = $('aiRememberKey').checked; $('settingsDialog').close(); notify('AI 接口设置已保存');
    } catch (error) { $('aiSettingsError').textContent = error.message; }
  });
  $('aiForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (controller || pending) return;
    const requirement = $('aiRequirement').value.trim();
    if (!requirement) return;
    if (!settings.url || !settings.model) { notify('请先设置 AI 接口地址和模型', true); $('settingsBtn').click(); return; }
    finishGesture();
    const base = clone(getProject()); const baseId = versions.head;
    const context = clone(messages);
    controller = new AbortController(); const active = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; active.abort(); }, 120_000);
    addMessage('user', requirement); $('aiRequirement').value = '';
    $('aiStatus').textContent = 'AI 正在生成…可以继续编辑画布。';
    try {
      const text = await requestAI(settings, requirement, base, context, active.signal);
      if (active.signal.aborted) throw new Error('请求已取消');
      const response = parseAIResponse(text, base, sanitizeContent);
      finishGesture();
      const aiId = versions.add(response.project, `AI：${response.summary}`, { parent: baseId, branch: true });
      addMessage('assistant', response.summary);
      if (versions.head === baseId) {
        versions.checkout(aiId); applyProject(response.project, `AI：${response.summary}`);
        addMessage('system', 'AI 修改已应用，并保留请求前的版本。'); notify('AI 修改已应用，可在版本中回退');
      } else {
        pending = { baseId, aiId, summary: response.summary };
        addMessage('system', '等待期间项目已有修改。AI 版本已保留，请查看并合并。'); setPanel(true);
        notify('AI 已返回，本地修改已保留，请查看并合并');
      }
      $('aiStatus').textContent = pending ? '请先处理待合并版本，再发送下一条需求。' : '完成，可以继续提出修改需求。';
    } catch (error) {
      const message = active.signal.aborted ? timedOut ? 'AI 请求超时，请重试' : 'AI 请求已取消' : error.message;
      $('aiStatus').textContent = message; addMessage('system', message); notify(message, !active.signal.aborted);
      if (!$('aiRequirement').value) $('aiRequirement').value = requirement;
    } finally { clearTimeout(timeout); controller = null; renderMessages(); renderVersions(); scheduleSave(); }
  });
  $('aiCancelBtn').addEventListener('click', () => controller?.abort());
  $('mergeOpenBtn').addEventListener('click', openMerge);
  $('discardAIBtn').addEventListener('click', () => { pending = null; addMessage('system', '已放弃应用 AI 修改，AI 版本仍保留在版本记录中。'); $('aiStatus').textContent = '可以继续发送需求。'; });
  $('mergeApplyBtn').addEventListener('click', () => {
    try {
      finishGesture();
      if (versions.head !== mergeHead) { choices = {}; renderMerge(); throw new Error('本地版本已改变，已重新计算合并，请重新确认'); }
      const result = pendingMerge();
      if (result.conflicts.some(conflict => !['local', 'ai'].includes(choices[conflict.key]))) throw new Error('请为每项冲突选择保留本地或采用 AI');
      const next = validate(result.project);
      versions.add(next, `合并 AI：${pending.summary}`, { mergeParent: pending.aiId });
      pending = null; applyProject(next, '合并 AI 修改'); $('mergeDialog').close();
      addMessage('system', 'AI 和本地修改已合并，两个来源版本均已保留。'); $('aiStatus').textContent = '合并完成，可以继续提出需求。'; notify('合并完成，可随时回退');
    } catch (error) { $('mergeError').textContent = error.message; }
  });
  $('mergeDialog').addEventListener('close', () => $('mergePreview').removeAttribute('srcdoc'));
  $('versionsBtn').addEventListener('click', () => { finishGesture(); renderVersions(); $('versionsDialog').showModal(); });
  $('versionsExportBtn').addEventListener('click', () => { finishGesture(); download(JSON.stringify(serialize(), null, 2), 'protolab-versions.json', 'application/json'); notify('项目、版本和对话已备份'); });
  $('versionsImportBtn').addEventListener('click', () => $('versionsFileInput').click());
  $('versionsFileInput').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try {
      if (controller || pending) throw new Error('请先取消请求或处理待合并版本，再导入备份');
      if (file.size > 50 * 1024 * 1024) throw new Error('版本备份不能超过 50 MB');
      const imported = validateWorkspace(JSON.parse(await readFile(file)), validate);
      // 导入图作为独立分支追加，避免覆盖已有记录或产生标识碰撞。
      finishGesture();
      const mapping = new Map(imported.versions.entries.map(entry => [entry.id, crypto.randomUUID()]));
      const existing = versions.serialize();
      const entries = imported.versions.entries.map(entry => ({ ...entry, id: mapping.get(entry.id), parent: mapping.get(entry.parent) || null, ...(entry.mergeParent ? { mergeParent: mapping.get(entry.mergeParent) } : {}) }));
      const head = mapping.get(imported.versions.head);
      versions = createVersions(initial, { head, entries: [...existing.entries, ...entries] });
      if (imported.pending) pending = { ...imported.pending, baseId: mapping.get(imported.pending.baseId), aiId: mapping.get(imported.pending.aiId) };
      messages.push(...imported.messages);
      applyProject(versions.current, '导入版本备份'); renderVersions(); addMessage('system', '已导入备份并打开其当前版本，原有版本完整保留。'); notify('版本备份已导入');
    } catch (error) { notify(error.message || '版本备份导入失败', true); }
  });
  renderMessages();
  return {
    persist() { writeStorage(WORKSPACE_KEY, serialize()); },
    record(project, label) { versions.add(project, label || '手动修改'); if ($('versionsDialog').open) renderVersions(); },
  };
}
