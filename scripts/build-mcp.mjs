import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');

// 仅打包这些已知模块：保留各模块作用域和 Node 内置导入，无第三方依赖。
const builtinImports = new Map();
async function source(file) {
  let text = await readFile(resolve(root, file), 'utf8');
  text = text.replace(/^import \{ (.*?) \} from '(.*?)';\n/gm, (line, names, path) => {
    if (path.startsWith('node:')) {
      const values = builtinImports.get(path) || new Set();
      names.split(',').forEach(name => values.add(name.trim())); builtinImports.set(path, values);
    }
    return '';
  });
  return text.replace(/^export /gm, '');
}
const tools = await source('src/mcp-tools.js');
const config = await source('src/mcp-config.js');
const bridge = await source('scripts/mcp-bridge.mjs');
const stdio = (await source('scripts/mcp-server.mjs')).split("\nif (process.argv[1] && import.meta.url")[0];
const entry = await source('scripts/mcp-sidecar.mjs');
const imports = [...builtinImports].map(([path, names]) => `import { ${[...names].join(', ')} } from '${path}';`).join('\n');
const bundle = `// 易设 MCP 外挂，运行：node protolab-mcp.mjs\n// 由 scripts/build-mcp.mjs 生成，无需安装依赖。\n${imports}\n\n` +
  `const { MCP_TOOLS, MCP_INSTRUCTIONS, validateToolArguments } = (() => {\n${tools}\nreturn { MCP_TOOLS, MCP_INSTRUCTIONS, validateToolArguments };\n})();\n\n` +
  `const { bridgeURL } = (() => {\n${config}\nreturn { bridgeURL };\n})();\n\n` +
  `const { createMCPBridge } = (() => {\n${bridge}\nreturn { createMCPBridge };\n})();\n\n` +
  `const { startMCPStdio } = (() => {\n${stdio}\nreturn { startMCPStdio };\n})();\n\n${entry}`;
const target = resolve(root, 'downloads/protolab-mcp.mjs');
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== bundle) { console.error('外挂下载文件与源码不一致，请运行 npm run build:mcp'); process.exitCode = 1; }
  else console.log('外挂下载文件与源码一致');
} else {
  await mkdir(resolve(root, 'downloads'), { recursive: true });
  await writeFile(target, bundle); console.log(`外挂已生成：${Buffer.byteLength(bundle)} 字节`);
}
