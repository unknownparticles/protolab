import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTES, normalizeDesign, designAssets, libraryManifest, linkedComponents } from '../src/project-design.js';
import { projectDetails, emptyProject, projectRecord, validateProjects } from '../src/projects.js';
import { projectFile } from '../src/project-import.js';
import { COMPONENTS } from '../src/presets.js';
import { generationBase, parseGenerationResponse, parseAIResponse, requestAI } from '../src/ai.js';
const clean = value => value;
const groups = [{ id: 'forms', name: '表单' }];
const library = [...COMPONENTS, { id: 'login', name: '登录按钮', type: 'html', content: '<button>登录</button>', defaultWidth: 180, defaultHeight: 48, groupId: 'forms' }];
const design = () => normalizeDesign({ palette: PALETTES.purple, library: { scope: 'groups', groupIds: ['forms'] }, safeArea: { mode: 'custom', top: 24, right: 16, bottom: 20, left: 16 } });
const reply = changes => JSON.stringify({ version: 1, name: '登录页面', summary: '复用登录组件', changes });

test('旧工程默认关联当前组件库与页面安全区，新设置随目录和工程导出恢复', () => {
  assert.deepEqual(projectDetails({ name: '旧工程' }).design, normalizeDesign());
  const entry = projectRecord({ name: '设计工程', design: design() }, emptyProject(), library);
  const catalog = validateProjects({ version: 1, activeId: entry.id, entries: [entry] }, clean);
  assert.deepEqual(catalog.entries[0].design, design());
  const file = JSON.parse(projectFile(entry.project, library, entry, groups));
  assert.deepEqual(projectDetails(file.details).design, design());
  const original = design(); const next = normalizeDesign(original); next.palette.colors.primary = '#000000';
  assert.equal(original.palette.colors.primary, PALETTES.purple.colors.primary);
  for (const invalid of [null, { palette: { name: '错误', colors: {} } }, { library: { scope: 'missing' } }, { library: { scope: 'groups', groupIds: [null] } }, { safeArea: { mode: 'custom', top: -1 } }]) assert.throws(() => normalizeDesign(invalid));
});
test('轻量清单只包含关联组件基础属性，分组删除不会扩大引用范围', () => {
  const linked = linkedComponents(design(), library, groups);
  assert.equal(linked.length, 1);
  assert.deepEqual(libraryManifest(linked, groups).components[0], { id: 'login', name: '登录按钮', type: 'html', width: 180, height: 48, group: '表单' });
  assert.equal(JSON.stringify(libraryManifest(library)).includes('<button>'), false);
  assert.equal(linkedComponents(design(), library, []).length, 0);
  assert.equal(linkedComponents({ library: { scope: 'none' } }, library).length, 0);
  assert.equal(linkedComponents({ library: { scope: 'custom' } }, library).length, 1);
  library.at(-1).defaultWidth = 190;
  assert.equal(libraryManifest(linkedComponents(design(), library, groups)).components[0].width, 190);
  library.at(-1).defaultWidth = 180;
});
test('三种请求携带轻量关联上下文，独立生成保留配色与页面安全区', async () => {
  const project = emptyProject();
  const assets = designAssets(design(), project, library, groups);
  const pageBase = generationBase(project, 'page', assets.context);
  assert.equal(pageBase.canvas.background, PALETTES.purple.colors.background);
  assert.equal(pageBase.safeArea.top, 24);
  assert.equal(generationBase(project, 'component', assets.context).safeArea.enabled, false);
  assert.equal(assets.context.safeArea.bounds.x, 16);
  for (const mode of ['modify', 'page', 'component']) {
    let sent;
    await requestAI({ url: 'https://ai.example.test', model: 'test' }, '设计登录页', project, [], undefined, async (_, options) => {
      sent = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: reply([]) } }] }) };
    }, { mode, designContext: assets.context });
    assert.deepEqual(JSON.parse(sent.messages.at(-1).content).designContext, assets.context);
    assert.match(sent.messages[0].content, /libraryId/);
    assert.equal(JSON.stringify(sent).includes('<button>登录</button>'), false);
  }
  const huge = design(); huge.safeArea.top = 2000; huge.safeArea.bottom = 2000;
  assert.ok(designAssets(huge, project, library, groups).context.safeArea.bounds.height >= 1);
});
test('智能引用由本地还原真实内容和默认尺寸，安全区约束生效，未知引用拒绝', () => {
  const project = emptyProject();
  const assets = designAssets(design(), project, library, groups);
  const options = { library: structuredClone(assets.library), designContext: assets.context };
  const changes = [{ op: 'add', item: { id: 'new-login', libraryId: 'login', x: 0, y: 0 } }, { op: 'safeArea', fields: { enabled: false, top: 0 } }];
  const result = parseAIResponse(reply(changes), project, clean, options);
  assert.equal(result.project.items[0].content, '<button>登录</button>');
  assert.equal(result.project.items[0].width, 180);
  assert.equal(result.project.items[0].x, 16);
  assert.ok(result.project.items[0].y >= assets.context.safeArea.bounds.y);
  assert.equal(result.project.safeArea.enabled, true);
  assert.equal(result.project.safeArea.top, 24);
  assert.equal(project.items.length, 0);
  for (const libraryId of ['missing', 'lib-btn']) assert.throws(() => parseAIResponse(reply([{ op: 'add', item: { id: 'x', libraryId, x: 0, y: 0 } }]), project, clean, options), /未关联/);
  assert.throws(() => parseAIResponse(reply([{ op: 'add', item: { id: 'x', libraryId: 'login', content: '<p>篡改</p>', x: 0, y: 0 } }]), project, clean, options), /无需提供/);
  for (const mode of ['page', 'component']) {
    const base = generationBase(project, mode, assets.context);
    const additions = changes.slice(0, 1);
    if (mode === 'page') {
      additions[0] = { ...additions[0], item: { ...additions[0].item, parentId: 'section' } };
      additions.unshift({ op: 'add', item: { id: 'section', name: '登录区', type: 'html', content: '<div></div>', x: 16, y: 80, width: 180, height: 48, container: { mode: 'vertical', gap: 0 }, appearance: { background: 'transparent' } } });
    }
    const generated = parseGenerationResponse(reply(additions), base, mode, clean, options);
    assert.equal(generated.project.items.find(item => !item.container).content, '<button>登录</button>');
    if (mode === 'component') { assert.equal(generated.component.defaultHeight, 48); assert.equal(generated.project.items[0].x, 0); }
  }
});
