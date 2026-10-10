import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
let failed = false;
for (const directory of ['src', 'scripts', 'tests']) {
  for (const name of await readdir(resolve(root, directory))) {
    if (!/\.(?:js|mjs)$/.test(name)) continue;
    const result = spawnSync(process.execPath, ['--check', resolve(root, directory, name)], { encoding: 'utf8' });
    if (result.status !== 0) { console.error(result.stderr); failed = true; }
  }
}
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
if (new Set(ids).size !== ids.length) { console.error('页面存在重复标识'); failed = true; }
for (const source of ['src/app.js', 'src/assistant.js', 'src/mcp-connection.js']) {
  const app = await readFile(resolve(root, source), 'utf8');
  for (const match of app.matchAll(/\$\('([^']+)'\)/g)) {
    if (!ids.includes(match[1])) { console.error(`缺少页面元素：${match[1]}`); failed = true; }
  }
}
process.exitCode = failed ? 1 : 0;
if (!failed) console.log('模块语法、页面标识及静态绑定检查通过');
