# Protolab · 原型实验室

浏览器里的轻量原型设计器：从组件库拖拽搭建界面，编辑尺寸与布局，导出可独立打开的 HTML。纯静态 HTML、CSS、原生 JavaScript，无框架、无后端、无运行时依赖。

## 本地运行

需要 Node.js 20.11 或更高版本。无需安装依赖：

```sh
npm run dev
```

访问 http://127.0.0.1:4173。可用 `PORT=8080 npm run dev` 指定端口。由于源码使用原生 ES 模块，请通过 HTTP 访问编辑器；导出的 `prototype.html` 可直接双击打开。

## 已实现

- 手机 375 × 667、平板 768 × 1024、PC 1280 × 800；横竖切换和 100～2000 px 自定义画布。
- 23 个内置组件：14 个普通组件（按钮、文本、输入框、多行文本框、滑杆、选择控件等）和 9 个矢量图形（点、线段、矩形、圆形、椭圆、三角形、箭头、菱形、星星）；拖拽或点击添加。
- 手机全面屏/经典外框、平板窄边框/经典外框、电脑显示器/笔记本/浏览器窗口；支持隐藏外框和自定义 HTML 外框。
- 手机和平板可选时间电量栏、手势横条或三键导航；时间与电量可编辑。外框和系统栏支持自动保存、撤销重做、预览及 HTML 导出。
- 位置、尺寸、0～50 px 圆角、内外边距；缩小画布时自动约束尺寸和位置。
- 25%～200% 缩放和适应窗口；放置与移动按实际画布像素计算。
- HTML、SVG 和图片自定义组件；搜索；组件库本地保存、JSON 导入导出；兼容原稿的旧格式。
- 草稿自动恢复、撤销重做、图层选中与排序。
- 预览与 HTML 导出共用结构和样式；导出无外部 CDN 依赖。
- 小屏折叠侧栏；键盘操作、焦点提示、低动效模式。

## 操作说明

点击或拖拽左侧组件到画布，右侧输入属性后点击「应用属性」。画布上的组件按住可移动，点击空白取消选中。自定义组件保存后会自动写入当前浏览器，组件库的「导出」生成 `protolab-library.json`，「导入」校验整个文件后确认替换自定义组件，内置组件和画布内容保留。读取旧组件库时自动补齐内置组件。

在右侧「设备外框」中选择样式。点击「编辑自定义 HTML 外框」可绘制装饰并设置四边留白（各 0～200 px），HTML 的 100% 宽高对应整个外框，画布按留白嵌入其中。支持静态 HTML / SVG 与内联样式。设备类型可独立于自定义画布尺寸选择。

顶部系统栏覆盖画布顶部 28 px；手势栏覆盖底部 28 px，三键导航覆盖底部 40 px，设计时请留出空间。电脑隐藏系统栏，切回手机或平板会恢复设置。

画布尺寸不包含设备外框和编辑器的画板标题。X、Y 定义组件外框位置，内边距作用于组件外框，外边距作用于内部内容，不改变外框坐标。这保证边界约束和导出一致。

| 快捷键 | 操作 |
| --- | --- |
| Ctrl / ⌘ Z | 撤销 |
| Ctrl / ⌘ Shift Z 或 Ctrl / ⌘ Y | 重做 |
| Ctrl / ⌘ D | 复制所选组件 |
| 方向键 / Shift + 方向键 | 移动 1 px / 10 px |
| Delete / Backspace | 删除所选组件 |
| Esc | 取消拖动及选择 |

在文本输入框、下拉框或弹窗内，编辑器快捷键暂停。

## 文件结构

```text
index.html                语义化编辑器界面与弹窗
styles/app.css            设计变量、布局、交互及响应式样式
src/app.js                界面绑定、渲染与指针交互
src/model.js              画布模型、边界约束、校验与历史
src/presets.js            普通组件和矢量图形库
src/frames.js             设备外框配置与几何尺寸
src/icons.js              离线 SVG 界面图标
src/content.js            静态内容清理、共享样式及 HTML 导出
src/storage.js            浏览器存储、文件读取与下载
scripts/serve.mjs         无依赖本地静态服务器
scripts/check.mjs         语法与页面绑定检查
scripts/browser-test.mjs  浏览器验收脚本
tests/                    模型回归测试
docs/design-requirements.md 原始需求
docs/implementation-plan.md 模块拆解、验收与后续计划
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
```

验收脚本自动启动临时服务，覆盖拖拽、缩放、属性、历史、文件导入导出、草稿恢复、窄屏面板和存储异常；截图写入不参与提交的 `test-results/`。已有 Playwright 可通过 `PROTOLAB_PLAYWRIGHT_MODULE` 指定其 `index.mjs`，通过 `PROTOLAB_BROWSER_EXECUTABLE` 指定浏览器执行文件，或用 `PROTOLAB_TEST_URL` 测试已启动服务。

## GitHub Pages

将代码推送到远程 `main` 后，在仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。工作流先执行测试与静态检查，然后只发布 `index.html`、`src/`、`styles/`。所有资源采用相对地址，可放在项目子路径。仓库文档及原始资料不进入 Pages 发布目录。

目标公开仓库为 `unknownparticles/protolab`，Pages 使用此工作流发布。后续每次推送 `main` 都会在检查通过后自动更新网站。

## 数据与边界

- 所有数据只保存在当前浏览器和站点来源；无登录、上传或团队同步。清除站点数据会删除草稿和组件库，请使用 JSON 与 HTML 导出备份。
- 自动保存有 300 ms 合并延迟；页面隐藏和离开时也尝试保存。存储失败会明确提示，内存中的设计仍可导出。
- 单画布最多 200 个组件，组件库最多 200 个组件（包含 23 个内置组件）；库文件总大小最多 12 MB，单张图片最多 3 MB，单组件代码最多 100000 字符，撤销最多保留 60 个状态。
- 自定义组件支持静态 HTML、SVG 及常用内联样式。脚本、事件属性、外部资源、页面级样式和活动嵌入会被移除。SVG 中引用外部或内部 ID 的滤镜、渐变、`use` 等暂不支持；PNG / JPEG / GIF / WebP / AVIF 通过图片导入。
- 导出包含设备外框、系统栏、原型及组件，保留输入框等基础交互。响应式预览、组件嵌套、团队协作和 React / Vue 导出属于后续计划。
- 本次端到端验证使用 Chromium；Firefox、Safari 与 Edge 的人工验收仍待补充。200 组件压力测试不是所有设备达到 60 fps 的保证。

用户提供的原始资料保存在 `docs/`，用于追踪改进。授权范围尚未明确，未额外添加开源许可证。
