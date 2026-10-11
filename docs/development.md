# 开发指南

## 文件结构

```text
index.html                语义化编辑器界面与弹窗
styles/app.css            设计变量、布局、交互及响应式样式
src/app.js                工程状态协调、画布渲染与指针交互
src/page-panel.js         页面管理与点击动作表单
src/project-settings.js   工程设置表单与素材关联
src/model.js              画布模型、边界约束、校验与历史
src/orientation.js        屏幕方向响应配置及展示计算
src/pages.js              页面、弹窗、点击动作及引用校验
src/prototype-runtime.js  预览与导出的固定交互脚本
src/layout.js             多选包围框、对齐和整组移动
src/guides.js             辅助线设置和像素标尺刻度
src/presets.js            普通组件和矢量图形库
src/frames.js             设备外框配置与几何尺寸
src/icons.js              离线 SVG 界面图标
src/assets/logo.svg       品牌标识与网站图标
src/i18n.js               系统语言识别、偏好保存与界面翻译
src/locales.js            中英双语文案目录
src/content.js            静态内容清理、共享样式及 HTML 导出
src/content-editor.js     文本节点、表单内容和图片编辑
src/appearance.js         样式校验、四边间距及共享展示规则
src/storage.js            浏览器存储、文件读取与下载
src/projects.js           多工程列表、独立快照、迁移与校验
src/ai.js                 AI 固定协议、接口请求和返回校验
src/assistant.js          对话、设置、版本与合并交互
src/mcp-editor.js         MCP 模型操作与写入版本检查
src/mcp-connection.js     浏览器标签页连接与客户端配置界面
src/mcp-protocol.js       MCP 工具清单、参数与协议说明
src/mcp-tools.js          浏览器与外挂共用的工具定义
src/mcp-config.js         五种客户端配置生成
src/versions.js           持久版本图和字段级三方合并
src/project-import.js     工程文件校验及隔离 HTML 布局识别
scripts/serve.mjs         无依赖本地静态服务器
scripts/mcp-bridge.mjs    本地标签页请求桥
scripts/mcp-server.mjs    标准 MCP 输入输出服务
scripts/mcp-config.mjs    客户端配置生成命令
scripts/mcp-sidecar.mjs   线上网页本机外挂入口
scripts/build-mcp.mjs     无依赖单文件外挂打包
downloads/protolab-mcp.mjs 可独立运行的外挂下载文件
scripts/check.mjs         语法与页面绑定检查
tests/*.test.mjs          模型回归测试
tests/browser/           浏览器验收及共用启动工具
docs/design-requirements.md 原始需求
docs/implementation-plan.md 模块拆解、验收与后续计划
docs/mcp.md              MCP 接入和五种客户端配置说明
docs/reference/original.html 原始单文件页面
.github/workflows/pages.yml GitHub Pages 发布工作流
```

## 验证

```sh
npm test
npm run check
```

浏览器验收是可选开发工具，需要安装 Playwright 及浏览器：

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:browser
npm run test:menus
npm run test:guides
npm run test:project
npm run test:ai
npm run test:orientation
npm run test:pages
npm run test:projects
npm run test:i18n
npm run test:mcp
npm run test:sidecar
```

验收脚本自动启动临时服务，覆盖拖拽、缩放、属性、历史、文件导入导出、草稿恢复、窄屏面板和存储异常；截图写入不参与提交的 `test-results/`。已有 Playwright 可通过 `PROTOLAB_PLAYWRIGHT_MODULE` 指定其 `index.mjs`，通过 `PROTOLAB_BROWSER_EXECUTABLE` 指定浏览器执行文件，或用 `PROTOLAB_TEST_URL` 测试已启动服务。

## GitHub Pages

将代码推送到远程 `main` 后，在仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。工作流先执行测试与静态检查，然后发布 `index.html`、`src/`、`styles/` 和单文件外挂 `downloads/`。所有资源采用相对地址，可放在项目子路径。仓库文档及原始资料不进入 Pages 发布目录。

目标公开仓库为 `unknownparticles/protolab`，Pages 使用此工作流发布。后续每次推送 `main` 都会在检查通过后自动更新网站。

部分专项验收使用相同端口，请顺序运行。可用 `npm run` 查看全部专项命令，包含字号、框选、容器及 AI 传输等验收。

## 仓库维护

- `src/`、`styles/`、`index.html` 是应用资源；使用原生模块，无需安装运行时依赖。
- `scripts/` 只放本地服务、MCP 工具和静态检查。浏览器验收统一放在 `tests/browser/`，`harness.mjs` 负责服务启动、浏览器加载及资源清理。新增验收复用它，npm 命令保持原名称。
- `npm run check` 递归检查源码、工具和测试，并核对页面标识与所有源码的静态绑定。
- `test-results/` 是忽略提交的本地验收产物；`final.mp4` 是保留的演示资料，不进入网站发布包。
- 修改前保存中文基线提交，验证符合预期后再提交；保留原始资料及无关文件。
