import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItem, createItem, validateProject, validateLibrary } from '../src/model.js';
import { COMPONENTS } from '../src/presets.js';
import { itemHTML, exportHTML } from '../src/content.js';

const canvas = { width: 600, height: 500, preset: 'custom' };
test('默认组件记录原始尺寸，缩放与工程往返保留字号基准', () => {
  const button = createItem(COMPONENTS[0], canvas);
  assert.deepEqual(button.textBasis, { width: 112, height: 40 });
  const enlarged = normalizeItem({ ...button, width: 224, height: 80 }, canvas);
  assert.deepEqual(enlarged.textBasis, button.textBasis);
  const project = validateProject({ version: 1, canvas, items: [enlarged] }, value => value);
  assert.deepEqual(project.items[0].textBasis, button.textBasis);
  assert.deepEqual(normalizeItem({ ...project.items[0], width: 112, height: 40 }, canvas).textBasis, button.textBasis);
  assert.match(itemHTML(enlarged), /data-text-basis="\{&quot;width&quot;:112,&quot;height&quot;:40\}"/);
});

test('旧组件以原始设计尺寸适配，容器和矢量不使用文字缩放', () => {
  const raw = { type: 'html', width: 800, height: 80, content: '<span>文字</span>' };
  assert.deepEqual(normalizeItem(raw, canvas).textBasis, { width: 800, height: 80 });
  assert.equal(normalizeItem({ ...raw, type: 'svg' }, canvas).textBasis, undefined);
  assert.equal(normalizeItem({ ...raw, container: { mode: 'vertical' } }, canvas).textBasis, undefined);
});

test('显式字号保留覆盖标识，导出携带统一文字布局逻辑', () => {
  const item = createItem({ ...COMPONENTS[0], appearance: { fontSize: 20 } }, canvas);
  assert.match(itemHTML(item), /styled-font-size/);
  const html = exportHTML(validateProject({ version: 1, canvas, items: [item] }, value => value));
  assert.match(html, /function fitItemText/);
  assert.match(html, /data-text-basis/);
});

test('放大后的组件保存到组件库后保留原始字号基准', () => {
  const [component] = validateLibrary([{ ...COMPONENTS[0], defaultWidth: 224, defaultHeight: 80, textBasis: { width: 112, height: 40 } }], value => value);
  const restored = createItem(JSON.parse(JSON.stringify(component)), canvas);
  assert.equal(restored.height, 80);
  assert.deepEqual(restored.textBasis, { width: 112, height: 40 });
});
