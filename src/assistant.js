import { t, getLocale } from './i18n.js';
import { switchPage, activePage } from './pages.js';
import { normalizeReferenceSpec, layoutReference } from './ai-reference.js';
import { clone, validateProject } from './model.js';
import { sanitizeContent, exportHTML } from './content.js';
import { readStorage, writeStorage, download, readFile } from './storage.js';
import { AI_SETTINGS_KEY, DESIGN_SPEC, normalizeAISettings, parseAIResponse, requestAI, generationBase, parseGenerationResponse } from './ai.js';
import { WORKSPACE_KEY, createVersions, validateWorkspace, mergeProjects } from './versions.js';
import { MAX_REFERENCE_IMAGE, IMAGE_UI_REQUIREMENT, imageCanvasSize } from './image-ui.js';

const $ = id => document.getElementById(id);
const validate = value => validateProject(value, sanitizeContent);
export function createAssistant({ initial, initialSavedAt, initialWorkspace, getProject, getRules, getDesignAssets, restoreInitial, applyProject, applyGeneration, finishGesture, notify, scheduleSave, startupWarning }) {
  let saved = initialWorkspace;
  try { if (initialWorkspace === undefined) saved = readStorage(WORKSPACE_KEY, value => validateWorkspace(value, validate)); }
  catch { startupWarning(t('版本或对话记录读取失败，已使用本地草稿')); }
  let versions = createVersions(initial, saved?.versions);
  if (saved) restoreInitial(initialWorkspace !== undefined || Date.parse(initialSavedAt) > Date.parse(saved.savedAt || '1970-01-01') ? initial : saved.project || versions.current);
  let messages = saved?.messages || [];
  let pending = saved?.pending || null;
  let settings = normalizeAISettings();
  let rememberKey = false;
  try { settings = readStorage(AI_SETTINGS_KEY, normalizeAISettings) || settings; rememberKey = !!settings.key; }
  catch { startupWarning(t('AI 设置读取失败，请重新配置')); }
  let controller = null;
  let session = 0;
  let generated = null;
  let referenceImage = null;
  let imageRead = 0;
  let imageLoading = false;
  let choices = {};
  let mergeHead = null;
  let mergeProject = null;
  const serialize = () => ({ version: 1, project: clone(getProject()), versions: versions.serialize(), messages: clone(messages), pending: clone(pending) });
  let targetActive = null;
  function setPanel(open) {
    $('aiPanel').hidden = !open;
    $('aiToggleBtn').setAttribute('aria-expanded', String(open));
    if (open) renderMode();
  }
  function renderMessages() {
    $('aiMessages').replaceChildren();
    const visible = messages.length ? messages : [{ role: 'system', content: t('先在设置中连接 AI，再描述客户需求。等待 AI 时可以继续编辑画布，返回后可合并修改。') }];
    for (const message of visible) {
      const node = document.createElement('div'); node.className = `ai-message ${message.role}`;
      const label = document.createElement('strong'); label.textContent = { user: t('客户需求'), assistant: t('AI 助手'), system: t('操作记录') }[message.role];
      const text = document.createElement('span'); text.textContent = message.role === 'system' ? t(message.content) : message.content;
      node.append(label, text); $('aiMessages').append(node);
    }
    $('aiMessages').scrollTop = $('aiMessages').scrollHeight;
    $('aiPending').hidden = !pending;
    $('aiPendingSummary').textContent = pending?.summary || '';
    $('aiSendBtn').disabled = !!controller || !!pending;
    $('aiCancelBtn').hidden = !controller;
    $('aiMode').disabled = !!controller || !!pending || !!generated;
    $('aiGenerated').hidden = !generated;
    $('aiSendBtn').disabled ||= !!generated;
    $('aiSendBtn').disabled ||= imageLoading;
    for (const id of ['aiImageFile', 'aiImageRemoveBtn', 'aiTarget', 'aiRefName', 'aiRefWidth', 'aiRefHeight', 'aiRefColor', 'aiRefFunction', 'aiRefBodyFont', 'aiRefTitleFont', 'aiRefSmallFont', 'aiRefGap']) $(id).disabled = !!controller || !!pending || !!generated || imageLoading;
  }
  function addMessage(role, content) { messages.push({ role, content }); renderMessages(); scheduleSave(); }
  function renderVersions() {
    $('versionsList').replaceChildren();
    const entries = versions.entries;
    const numbers = new Map(entries.map((entry, index) => [entry.id, index + 1]));
    for (const entry of entries.toReversed()) {
      const row = document.createElement('div'); row.className = `version-row${entry.id === versions.head ? ' current' : ''}`;
      const info = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = t`版本 ${numbers.get(entry.id)} · ${t(entry.label)}${entry.id === versions.head ? JSON.stringify(getProject()) === JSON.stringify(entry.project) ? t(' · 当前') : t(' · 编辑基准') : ''}`;
      const meta = document.createElement('small'); meta.textContent = t`${new Date(entry.createdAt).toLocaleString(getLocale())} · ${entry.project.items.length} 个组件${entry.parent ? t` · 源于版本 ${numbers.get(entry.parent)}` : ''}${entry.mergeParent ? t` · 合并版本 ${numbers.get(entry.mergeParent)}` : ''}`;
      info.append(title, meta);
      const button = document.createElement('button'); button.className = 'btn btn-sm'; button.textContent = t('回退到此版本'); button.disabled = entry.id === versions.head && JSON.stringify(getProject()) === JSON.stringify(entry.project);
      button.addEventListener('click', () => {
        finishGesture();
        const value = versions.checkout(entry.id);
        applyProject(value, t('版本回退')); renderVersions();
        addMessage('system', t`已回退到版本 ${numbers.get(entry.id)}，原有分支继续保留。`);
        notify(t('已回退到所选版本，原有修改仍在版本记录中'));
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
  const valueText = value => value === undefined ? t('（已删除 / 不存在）') : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const fieldNames = { canvas: '画布', frame: '设备外框', safeArea: '安全区', name: '名称', type: '组件类型', content: '组件内容', x: '横向位置', y: '纵向位置', width: '宽度', height: '高度', radius: '圆角', padding: '内边距', margin: '外边距', background: '背景', preset: '尺寸预设', device: '设备类型', style: '外框样式', camera: '摄像头', statusBar: '顶部系统栏', time: '时间', battery: '电量', navigation: '底部导航', html: '外框内容', insets: '外框留白', enabled: '启用限制', top: '上侧留白', right: '右侧留白', bottom: '下侧留白', left: '左侧留白' };
  function renderMerge() {
    if (!pending) return;
    const result = pendingMerge();
    mergeHead = versions.head;
    mergeProject = clone(getProject());
    $('mergeSummary').textContent = `${pending.summary} · ${result.conflicts.length ? t`${result.conflicts.length} 项冲突需要选择` : t('没有字段冲突，确认后应用合并结果')}`;
    $('mergeConflicts').replaceChildren();
    const entries = versions.entries;
    const sources = [getProject(), entries.find(entry => entry.id === pending.aiId).project, entries.find(entry => entry.id === pending.baseId).project];
    const sourceItems = sources.flatMap(project => project.pages ? project.pages.flatMap(page => page.items) : project.items);
    for (const conflict of result.conflicts) {
      const row = document.createElement('section'); row.className = 'merge-conflict';
      let path = conflict.path;
      if (path[0] === 'pages') {
        const page = sources.flatMap(project => project.pages || []).find(page => page.id === path[1]);
        path = [`${page?.kind === 'popup' ? t('弹窗') : t('页面')}「${page?.name || t('未命名')}」`, ...path.slice(2)];
      }
      const itemIndex = path.indexOf('items');
      if (itemIndex >= 0) path = [...path.slice(0, itemIndex), t`组件「${sourceItems.find(item => item.id === path[itemIndex + 1])?.name || t('未命名')}」`, ...path.slice(itemIndex + 2)];
      const titleText = path.map(part => fieldNames[part] ? t(fieldNames[part]) : part).join(' / ');
      const title = document.createElement('strong'); title.textContent = titleText;
      const values = document.createElement('div'); values.className = 'merge-values';
      for (const [label, value] of [[t('请求时基准'), conflict.base], [t('当前本地'), conflict.local], [t('AI 修改'), conflict.remote]]) {
        const column = document.createElement('div'); const heading = document.createElement('strong'); heading.textContent = label;
        const pre = document.createElement('pre'); pre.textContent = valueText(value); column.append(heading, pre); values.append(column);
      }
      const select = document.createElement('select'); select.setAttribute('aria-label', t`${titleText}的合并选择`); select.dataset.conflict = conflict.key;
      for (const [value, text] of [['', t('请选择保留内容')], ['local', t('保留当前本地')], ['ai', t('采用 AI 修改')]]) { const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option); }
      select.value = choices[conflict.key] || '';
      select.addEventListener('change', () => { choices[conflict.key] = select.value; updateMergePreview(); });
      row.append(title, values, select); $('mergeConflicts').append(row);
    }
    updateMergePreview();
  }
  function updateMergePreview() {
    try {
      $('mergePreview').srcdoc = exportHTML(validate(pendingMerge().project), { preview: true });
      $('mergeError').textContent = '';
    } catch (error) { $('mergePreview').removeAttribute('srcdoc'); $('mergeError').textContent = t`合并结果不可用：${error.message}`; }
  }
  function openMerge() {
    finishGesture(); choices = {}; renderMerge();
    if (!$('mergeDialog').open) $('mergeDialog').showModal();
  }
  $('aiToggleBtn').addEventListener('click', () => setPanel($('aiPanel').hidden));
  $('generateComponentBtn').addEventListener('click', () => { setPanel(true); if (!controller && !pending && !generated) { $('aiMode').value = 'component'; renderMode(); } $('aiRequirement').focus(); });
  $('generatePageBtn').addEventListener('click', () => { setPanel(true); if (!controller && !pending && !generated) { $('aiMode').value = 'page'; renderMode(); } $('aiRequirement').focus(); });
  $('generatePopupBtn').addEventListener('click', () => { setPanel(true); if (!controller && !pending && !generated) { $('aiMode').value = 'popup'; renderMode(); } $('aiRequirement').focus(); });
  for (const id of ['generateImageBtn', 'imageUIBtn']) $(id).addEventListener('click', () => { setPanel(true); if (!controller && !pending && !generated) { $('aiMode').value = 'image'; renderMode(); $('aiImageFile').focus(); } });
  function renderImage() {
    $('aiImagePreview').hidden = !referenceImage;
    if (referenceImage) $('aiImagePreview').src = referenceImage.dataURL;
    else $('aiImagePreview').removeAttribute('src');
    renderLayoutReference();
    $('aiImageRemoveBtn').hidden = !referenceImage;
    $('aiImageInfo').textContent = referenceImage ? t`画布 ${referenceImage.width} × ${referenceImage.height} px · 自动命名组件` : '';
  }
  function clearImage() {
    imageRead++; imageLoading = false; referenceImage = null; $('aiImageFile').value = ''; renderImage(); renderMessages();
  }
  $('aiImageRemoveBtn').addEventListener('click', clearImage);
  $('aiImageFile').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    const token = ++imageRead, currentSession = session;
    imageLoading = true; renderMessages(); $('aiStatus').textContent = t('正在读取参考图片…');
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 界面图片');
      if (file.size > MAX_REFERENCE_IMAGE) throw new Error('参考图片不能超过 3 MB');
      const dataURL = await readFile(file, 'dataURL');
      const image = new Image(); image.src = dataURL;
      try { await image.decode(); } catch { throw new Error('图片内容无效，无法读取'); }
      const size = imageCanvasSize(image.naturalWidth, image.naturalHeight);
      if (token !== imageRead || currentSession !== session) return;
      referenceImage = { dataURL, ...size }; renderImage(); $('aiStatus').textContent = '';
    } catch (error) { if (token === imageRead && currentSession === session) { $('aiStatus').textContent = t(error.message); notify(t(error.message), true); } }
    finally { if (token === imageRead && currentSession === session) { imageLoading = false; renderMessages(); } }
  });
  $('aiCloseBtn').addEventListener('click', () => setPanel(false));
  $('settingsBtn').addEventListener('click', () => {
    $('aiURL').value = settings.url; $('aiKey').value = settings.key; $('aiModel').value = settings.model;
    $('aiRememberKey').checked = rememberKey;
    $('aiSettingsError').textContent = ''; $('settingsDialog').showModal();
  });
  $('aiDeepSeekBtn').addEventListener('click', () => {
    $('aiURL').value = 'https://api.deepseek.com/v1';
    $('aiModel').value = 'deepseek-chat';
    $('aiKey').value = ''; $('aiRememberKey').checked = false;
    $('aiSettingsError').textContent = '';
    $('aiKey').focus();
  });
  $('aiSettingsForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const next = normalizeAISettings({ url: $('aiURL').value, key: $('aiKey').value, model: $('aiModel').value });
      writeStorage(AI_SETTINGS_KEY, { ...next, key: $('aiRememberKey').checked ? next.key : '' });
      const upgraded = new URL($('aiURL').value).protocol === 'http:' && new URL(next.url).protocol === 'https:';
      settings = next; rememberKey = $('aiRememberKey').checked; $('settingsDialog').close(); notify(upgraded ? t('AI 接口设置已保存，HTTPS 页面已将接口地址改为 HTTPS') : t('AI 接口设置已保存'));
    } catch (error) { $('aiSettingsError').textContent = t(error.message); }
  });
  $('aiForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (controller || pending || generated || imageLoading) return;
    const mode = $('aiMode').value;
    if (mode === 'image' && !referenceImage) { $('aiStatus').textContent = t('请先上传参考图片'); $('aiImageFile').focus(); return; }
    let referenceSpec;
    try { referenceSpec = readReferenceSpec(); } catch (error) { $('aiStatus').textContent = t(error.message); return; }
    const requirement = $('aiRequirement').value.trim() || referenceSpec.function || (referenceImage ? mode === 'image' ? IMAGE_UI_REQUIREMENT : t('根据参考图片和基础参考表完成所选设计任务。') : '');
    if (!requirement) { $('aiStatus').textContent = t('请输入需求、功能或上传参考图片'); $('aiRequirement').focus(); return; }
    if (!settings.url || !settings.model) { notify(t('请先设置 AI 接口地址和模型'), true); $('settingsBtn').click(); return; }
    finishGesture();
    const currentSession = session;
    const requestProject = clone(getProject());
    const target = selectedTarget();
    const assets = getDesignAssets ? clone(getDesignAssets(mode === 'modify' ? target : requestProject)) : {};
    const designOptions = { designContext: assets.context, library: assets.library, referenceSpec };
    const baseId = versions.add(requestProject, t('AI 生成前'), { force: true });
    const image = referenceImage ? clone(referenceImage) : null;
    const base = mode === 'modify' ? target : generationBase(requestProject, mode, assets.context, image, referenceSpec);
    if (mode !== 'modify' && mode !== 'image' && getDesignAssets) {
      designOptions.designContext = clone(getDesignAssets(base).context);
      if (mode === 'popup') designOptions.designContext.safeArea = { ...base.safeArea, mode: 'none', bounds: layoutReference(base, referenceSpec, mode).layout.bounds };
    }
    const context = clone(messages);
    controller = new AbortController(); const active = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; active.abort(); }, 120_000);
    addMessage('user', requirement); $('aiRequirement').value = '';
    $('aiStatus').textContent = t('AI 正在生成…可以继续编辑画布。');
    try {
      const text = await requestAI(settings, requirement, base, context, active.signal, fetch, { mode, rules: getRules(), ...designOptions, referenceImage: image });
      if (currentSession !== session) return;
      if (active.signal.aborted) throw new Error(t('请求已取消'));
      finishGesture();
      if (mode !== 'modify') {
        generated = { ...parseGenerationResponse(text, base, mode, sanitizeContent, designOptions), mode, referenceImage: image, referenceSpec };
        versions.add(getProject(), t`AI 生成后（待确认）：${generated.summary}`, { force: true });
        addMessage('assistant', generated.summary);
        $('aiGeneratedSummary').textContent = `${generated.name} · ${generated.summary}`;
        $('aiStatus').textContent = t('生成完成，请预览并确认保存。');
        showGenerated();
        return;
      }
      const response = parseAIResponse(text, base, sanitizeContent, designOptions);
      if (referenceSpec.name && response.project.pages) response.project.pages = response.project.pages.map(page => page.id === base.activePageId ? { ...page, name: referenceSpec.name } : page);
      if (requestProject.pages) response.project = switchPage(response.project, requestProject.activePageId);
      const aiId = versions.add(response.project, `AI：${response.summary}`, { parent: baseId, branch: true });
      addMessage('assistant', response.summary);
      if (versions.head === baseId && JSON.stringify(getProject()) === JSON.stringify(requestProject)) {
        versions.checkout(aiId); applyProject(response.project, `AI：${response.summary}`);
        addMessage('system', t('AI 修改已应用，并保留请求前的版本。')); notify(t('AI 修改已应用，可在版本中回退'));
      } else {
        pending = { baseId, aiId, summary: response.summary };
        addMessage('system', t('等待期间项目已有修改。AI 版本已保留，请查看并合并。')); setPanel(true);
        notify(t('AI 已返回，本地修改已保留，请查看并合并'));
      }
      $('aiStatus').textContent = pending ? t('请先处理待合并版本，再发送下一条需求。') : t('完成，可以继续提出修改需求。');
    } catch (error) {
      if (currentSession !== session) return;
      const message = active.signal.aborted ? timedOut ? t('AI 请求超时，请重试') : t('AI 请求已取消') : error.message;
      $('aiStatus').textContent = t(message); addMessage('system', message); notify(message, !active.signal.aborted);
      if (!$('aiRequirement').value) $('aiRequirement').value = requirement;
    } finally { clearTimeout(timeout); if (currentSession === session) { controller = null; renderMessages(); renderVersions(); scheduleSave(); } }
  });
  function showGenerated() {
    if (!generated) return;
    $('generationName').value = generated.name;
    $('generationSummary').textContent = generated.summary;
    $('generationApplyBtn').textContent = generated.mode === 'component' ? t('保存到组件库') : generated.mode === 'popup' ? t('添加为新弹窗') : t('添加为新页面');
    let preview = exportHTML(generated.project, { preview: true });
    if (generated.mode === 'image') {
      preview = preview.replace('</head>', '<style>html,body{height:100%;min-height:0;overflow:hidden}body{padding:0}.prototype-page{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}.device-shell{transform-origin:center}</style></head>');
      preview = preview.replace('</body>', `<script>const shell=document.querySelector('.device-shell');const fit=()=>{shell.style.transform='scale('+Math.min(1,(innerWidth-24)/shell.offsetWidth,(innerHeight-24)/shell.offsetHeight)+')';};new ResizeObserver(fit).observe(document.documentElement);fit();</script></body>`);
    }
    $('generationPreview').srcdoc = preview;
    $('generationComparison').classList.toggle('with-reference', !!generated.referenceImage);
    $('generationReference').hidden = !generated.referenceImage;
    if (generated.referenceImage) $('generationReferenceImage').src = generated.referenceImage.dataURL;
    else $('generationReferenceImage').removeAttribute('src');
    $('generationComponents').hidden = generated.mode !== 'image';
    $('generationComponentList').replaceChildren(...(generated.mode === 'image' ? generated.project.items : []).map(item => {
      const entry = document.createElement('li'); entry.textContent = item.name; return entry;
    }));
    renderReferenceRows($('generationLayoutRows'), layoutReference(generated.project, generated.referenceSpec, generated.mode));
    $('generationError').textContent = '';
    if (!$('generationDialog').open) $('generationDialog').showModal();
  }
  $('aiGeneratedOpenBtn').addEventListener('click', showGenerated);
  $('generationForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!generated) return;
    try {
      const name = $('generationName').value.trim();
      if (!name || name.length > 40) throw new Error(t('名称请输入 1～40 个字符'));
      finishGesture();
      applyGeneration({ ...generated, name });
      versions.add(getProject(), t`保存 AI 生成${generated.mode === 'component' ? t('组件') : generated.mode === 'popup' ? t('弹窗') : t('页面')}：${name}`, { force: true });
      renderVersions();
      const label = generated.mode === 'component' ? t('组件已保存到当前工程组件库，可点击或拖拽使用。') : generated.mode === 'popup' ? t('新弹窗已添加到当前工程，可继续编辑。') : t('新页面已添加到当前工程，可继续编辑。');
      generated = null; $('generationDialog').close(); addMessage('system', label); notify(label);
      $('aiStatus').textContent = t('已保存，可以继续提出需求。'); renderMessages();
    } catch (error) { $('generationError').textContent = t(error.message); }
  });
  $('discardGenerationBtn').addEventListener('click', () => { generated = null; $('generationDialog').close(); renderMessages(); $('aiStatus').textContent = t('已放弃生成结果，可以重新发送需求。'); });
  $('generationDialog').addEventListener('close', () => { $('generationPreview').removeAttribute('srcdoc'); $('generationReferenceImage').removeAttribute('src'); });
  $('aiMode').addEventListener('change', renderMode);
  function renderMode() {
    const mode = $('aiMode').value;
    $('aiImageFields').hidden = false;
    $('aiTargetField').hidden = mode !== 'modify';
    $('aiRequirement').required = false;
    refreshTargets();
    renderLayoutReference();
    $('aiModeHelp').textContent = mode === 'image' ? t('上传界面图片，AI 还原布局和文案，拆分可编辑组件并自动命名，预览后添加为新页面。') : mode === 'modify' ? t('发送当前工程和最近对话，修改当前页。') : mode === 'component' ? t('根据提示词和规范独立生成组件，预览后保存到当前工程组件库。') : mode === 'popup' ? t('根据提示词、参考图片和基础信息生成弹窗，预览后添加为新弹窗。') : t('根据提示词和规范独立生成页面，预览后添加为新页面。');
    $('aiSendBtn').textContent = mode === 'image' ? t('根据图片生成 UI') : mode === 'modify' ? t('发送需求') : mode === 'component' ? t('生成组件') : mode === 'popup' ? t('生成弹窗') : t('生成页面');
    const design = getDesignAssets?.().context;
    $('aiRulesSummary').textContent = mode === 'image' ? t('优先还原图片的布局、颜色和原文案；提示词可留空，也可填写额外要求。') : t`自动使用内置规范${getRules() ? t('、工程规范') : ''}${design?.palette ? t`、${design.palette.name}配色` : ''}${design ? t`、${design.library.components.length} 个关联组件及安全区信息` : ''}，可在「工程设置」中编辑。`;
    $('aiBuiltinRules').textContent = t(DESIGN_SPEC);
  }
  function readReferenceSpec() {
    return normalizeReferenceSpec(Object.fromEntries([
      ['name', 'Name'], ['width', 'Width'], ['height', 'Height'], ['color', 'Color'], ['function', 'Function'],
      ['bodyFont', 'BodyFont'], ['titleFont', 'TitleFont'], ['smallFont', 'SmallFont'], ['gap', 'Gap'],
    ].map(([key, suffix]) => [key, $('aiMode').value === 'image' && ['width', 'height'].includes(key) ? '' : $(`aiRef${suffix}`).value])), $('aiMode').value);
  }
  function refreshTargets() {
    const project = getProject(), previous = $('aiTarget').value;
    $('aiTarget').replaceChildren(...(project.pages || []).map(page => new Option(`${page.name} · ${t(page.kind === 'popup' ? '弹窗' : page.kind === 'toast' ? 'Toast' : '页面')}`, page.id)));
    $('aiTarget').value = targetActive === project.activePageId && project.pages?.some(page => page.id === previous) ? previous : project.activePageId || '';
    targetActive = project.activePageId;
  }
  function selectedTarget() {
    const project = getProject();
    return project.pages && $('aiTarget').value ? switchPage(project, $('aiTarget').value) : clone(project);
  }
  function renderLayoutReference() {
    try {
      const mode = $('aiMode').value;
      for (const id of ['aiRefWidth', 'aiRefHeight']) $(id).min = mode === 'component' ? '1' : '100';
      $('aiRefWidth').readOnly = $('aiRefHeight').readOnly = mode === 'image';
      const spec = readReferenceSpec();
      const board = mode === 'modify' ? selectedTarget() : generationBase(getProject(), mode === 'image' && !referenceImage ? 'page' : mode, getDesignAssets?.().context, referenceImage, spec);
      const reference = layoutReference(board, spec, mode), { typography, layout } = reference;
      $('aiRefWidth').placeholder = mode === 'component' ? t('自动') : String(board.canvas.width);
      $('aiRefHeight').placeholder = mode === 'component' ? t('自动') : String(board.canvas.height);
      $('aiRefName').placeholder = mode === 'modify' ? activePage(board)?.name || t('名称') : t('留空由 AI 命名');
      $('aiTypographySummary').textContent = t`字号：正文 ${typography.body} px（1 倍），标题 ${typography.title} px（${typography.titleRatio} 倍），辅助 ${typography.small} px（${typography.smallRatio} 倍）。组件间距 ${layout.gap} px。`;
      const b = layout.bounds;
      $('aiLayoutSummary').textContent = t`画布 ${layout.width} × ${layout.height} px；可排版区域 x ${b.x}～${b.x + b.width}，y ${b.y}～${b.y + b.height}；最大组件 ${b.width} × ${b.height} px，最多 ${layout.maxItems} 个组件。组件需完整位于区域内，避免意外重叠与文字裁切。`;
      const area = layout.safeArea;
      $('aiSafeAreaSummary').textContent = t`安全区限制：${t(area.enabled ? '已启用' : '未启用')}；留白上 ${area.top || 0} / 右 ${area.right || 0} / 下 ${area.bottom || 0} / 左 ${area.left || 0} px。坐标为画布实际像素。`;
      renderReferenceRows($('aiLayoutRows'), reference);
    } catch (error) { $('aiLayoutSummary').textContent = t(error.message); }
  }
  function renderReferenceRows(body, reference) {
      body.replaceChildren();
      for (const item of reference.components) {
        const row = document.createElement('tr');
        for (const value of [item.name, `${item.x} / ${item.y}`, `${item.width} × ${item.height}`, item.fontSize ? `${item.fontSize} px / ${item.fontRatio}×` : t('未指定'), item.color || t('未指定')]) {
          const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
        }
        const detail = document.createElement('small'); detail.textContent = item.function; row.firstChild.append(detail);
        body.append(row);
      }
      if (!reference.components.length) {
        const row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 5;
        cell.textContent = t('新内容生成后在预览中查看；优化已有页面时展示当前组件。'); row.append(cell); body.append(row);
      }
  }
  $('aiTarget').addEventListener('change', renderLayoutReference);
  for (const id of ['aiRefWidth', 'aiRefHeight', 'aiRefBodyFont', 'aiRefTitleFont', 'aiRefSmallFont', 'aiRefGap']) $(id).addEventListener('input', renderLayoutReference);
  $('aiCancelBtn').addEventListener('click', () => controller?.abort());
  $('mergeOpenBtn').addEventListener('click', openMerge);
  $('discardAIBtn').addEventListener('click', () => { pending = null; addMessage('system', t('已放弃应用 AI 修改，AI 版本仍保留在版本记录中。')); $('aiStatus').textContent = t('可以继续发送需求。'); });
  $('mergeApplyBtn').addEventListener('click', () => {
    try {
      finishGesture();
      if (versions.head !== mergeHead || JSON.stringify(getProject()) !== JSON.stringify(mergeProject)) { choices = {}; renderMerge(); throw new Error(t('本地设计已改变，已重新计算合并，请重新确认')); }
      const result = pendingMerge();
      if (result.conflicts.some(conflict => !['local', 'ai'].includes(choices[conflict.key]))) throw new Error(t('请为每项冲突选择保留本地或采用 AI'));
      const next = validate(result.project);
      versions.add(getProject(), t('AI 合并前'), { force: true });
      versions.add(next, t`合并 AI：${pending.summary}`, { mergeParent: pending.aiId });
      pending = null; applyProject(next, t('合并 AI 修改')); $('mergeDialog').close();
      addMessage('system', t('AI 和本地修改已合并，两个来源版本均已保留。')); $('aiStatus').textContent = t('合并完成，可以继续提出需求。'); notify(t('合并完成，可随时回退'));
    } catch (error) { $('mergeError').textContent = t(error.message); }
  });
  $('mergeDialog').addEventListener('close', () => $('mergePreview').removeAttribute('srcdoc'));
  $('versionsBtn').addEventListener('click', () => { finishGesture(); renderVersions(); });
  $('versionsExportBtn').addEventListener('click', () => { finishGesture(); download(JSON.stringify(serialize(), null, 2), 'protolab-versions.json', 'application/json'); notify(t('项目、版本和对话已备份')); });
  $('versionsImportBtn').addEventListener('click', () => $('versionsFileInput').click());
  $('versionsFileInput').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try {
      const currentSession = session;
      if (controller || pending) throw new Error(t('请先取消请求或处理待合并版本，再导入备份'));
      if (file.size > 50 * 1024 * 1024) throw new Error(t('版本备份不能超过 50 MB'));
      const imported = validateWorkspace(JSON.parse(await readFile(file)), validate);
      if (currentSession !== session) return;
      // 导入图作为独立分支追加，避免覆盖已有记录或产生标识碰撞。
      finishGesture();
      const mapping = new Map(imported.versions.entries.map(entry => [entry.id, crypto.randomUUID()]));
      const existing = versions.serialize();
      const entries = imported.versions.entries.map(entry => ({ ...entry, id: mapping.get(entry.id), parent: mapping.get(entry.parent) || null, ...(entry.mergeParent ? { mergeParent: mapping.get(entry.mergeParent) } : {}) }));
      const head = mapping.get(imported.versions.head);
      versions = createVersions(initial, { head, entries: [...existing.entries, ...entries] });
      if (imported.pending) pending = { ...imported.pending, baseId: mapping.get(imported.pending.baseId), aiId: mapping.get(imported.pending.aiId) };
      messages.push(...imported.messages);
      applyProject(imported.project || versions.current, t('导入版本备份')); renderVersions(); addMessage('system', t('已导入备份并打开其当前版本，原有版本完整保留。')); notify(t('版本备份已导入'));
    } catch (error) { notify(error.message || t('版本备份导入失败'), true); }
  });
  renderMessages();
  renderMode();
  return {
    snapshot: serialize,
    isBusy: () => !!controller || !!pending || !!generated,
    refreshRules: renderMode,
    refreshLocale() { renderMessages(); renderVersions(); renderMode(); renderImage(); if ($('mergeDialog').open) renderMerge(); },
    activate(project, workspace) {
      session++; controller?.abort(); controller = null;
      clearImage();
      versions = createVersions(project, workspace.versions);
      messages = clone(workspace.messages); pending = clone(workspace.pending); generated = null; choices = {}; mergeHead = null;
      for (const id of ['mergeDialog', 'generationDialog']) if ($(id).open) $(id).close();
      for (const id of ['aiRefName', 'aiRefWidth', 'aiRefHeight', 'aiRefColor', 'aiRefFunction']) $(id).value = '';
      $('aiRefBodyFont').value = '16'; $('aiRefTitleFont').value = '24'; $('aiRefSmallFont').value = '12'; $('aiRefGap').value = '16';
      targetActive = null;
      $('aiRequirement').value = ''; $('aiStatus').textContent = ''; $('aiMode').value = 'modify'; renderMode(); renderMessages();
    },
    persist(savedAt) { writeStorage(WORKSPACE_KEY, { ...serialize(), savedAt }); },
    saveVersion(label = t('手动保存')) { versions.add(getProject(), label, { force: true }); renderVersions(); },
    refreshVersions: renderVersions,
  };
}
