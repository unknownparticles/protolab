import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
let failed = false;
for (const directory of ['src', 'scripts', 'tests', 'downloads']) {
  for (const file of await moduleFiles(resolve(root, directory))) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) { console.error(result.stderr); failed = true; }
  }
}
const bundleCheck = spawnSync(process.execPath, [resolve(root, 'scripts/build-mcp.mjs'), '--check'], { encoding: 'utf8' });
if (bundleCheck.status !== 0) { console.error(bundleCheck.stderr); failed = true; }
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
if (new Set(ids).size !== ids.length) { console.error('页面存在重复标识'); failed = true; }
for (const source of await moduleFiles(resolve(root, 'src'))) {
  const app = await readFile(source, 'utf8');
  for (const match of app.matchAll(/\$\('([^']+)'\)/g)) {
    if (!ids.includes(match[1])) { console.error(`缺少页面元素：${match[1]}`); failed = true; }
  }
}
process.exitCode = failed ? 1 : 0;
if (!failed) console.log('模块语法、页面标识及静态绑定检查通过');

async function moduleFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await moduleFiles(file));
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(file);
  }
  return files;
}
