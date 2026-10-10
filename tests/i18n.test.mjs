import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocale, translate, LANGUAGE_OPTIONS } from '../src/i18n.js';
import { EN } from '../src/locales.js';

test('系统语言匹配中文地区与英文地区，显式偏好优先，其他语言回退英文', () => {
  assert.equal(resolveLocale('system', ['zh-TW', 'en-US']), 'zh');
  assert.equal(resolveLocale('system', ['zh-Hans-CN']), 'zh');
  assert.equal(resolveLocale('system', ['en-GB', 'zh-CN']), 'en');
  assert.equal(resolveLocale('system', ['fr-FR', 'zh-HK']), 'zh');
  assert.equal(resolveLocale('system', ['ja-JP']), 'en');
  assert.equal(resolveLocale('system', []), 'en');
  assert.equal(resolveLocale('en', ['zh-CN']), 'en');
  assert.equal(resolveLocale('zh', ['en-US']), 'zh');
  assert.deepEqual(LANGUAGE_OPTIONS, ['system', 'zh', 'en']);
});

test('翻译插值保留用户名称及特殊字符，未知文案回退原文', () => {
  const name = '按钮 <测试> $& {1}';
  assert.equal(translate('已添加「{0}」', [name], 'en'), `Added “${name}”`);
  assert.equal(translate('已添加「{0}」', [name], 'zh'), `已添加「${name}」`);
  assert.equal(translate('用户自定义名称', [], 'en'), '用户自定义名称');
  assert.equal(translate('{0} 个组件', [0], 'en'), '0 components');
});

test('双语目录的占位符对应，中文品牌与英文标题完整', () => {
  for (const [key, value] of Object.entries(EN)) {
    const placeholders = source => [...source.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
    assert.deepEqual(placeholders(value), placeholders(key), key);
  }
  assert.equal(translate('易设 · 原型设计工具', [], 'zh'), '易设 · 原型设计工具');
  assert.equal(translate('易设 · 原型设计工具', [], 'en'), 'Protolab · Prototype Designer');
});
