# 易设 · Protolab

浏览器里的轻量原型设计器：拖拽组件搭建界面，编辑布局和文案，预览交互并导出可独立打开的 HTML。使用原生 JavaScript、HTML 和 CSS，无框架、无后端、无运行时依赖。

## 快速开始

需要 Node.js 20.11 或更高版本，无需安装依赖：

```sh
npm run dev
```

访问 [本地编辑器](http://127.0.0.1:4173)。可用 `PORT=8080 npm run dev` 更换端口。编辑器需通过 HTTP 访问，导出的 `prototype.html` 可直接双击打开。

## 主要能力

- 手机、平板与电脑画布，设备外框、安全区、缩放、标尺和吸附。
- 基础控件、矢量图形、布局容器及自定义 HTML、SVG、图片组件库。
- 多选、对齐、文字与图片编辑、撤销重做、自动保存和版本回退。
- 多工程、多页面、弹窗、Toast 和点击交互；工程 JSON 与 HTML 导入导出。
- AI 对话调整、独立生成及参考图还原；接入用户配置的兼容接口。
- MCP 连接 Codex、Cursor、Claude Code、OpenCode 和 Antigravity。
- 中文与 English，可跟随系统语言。

工程数据保存在当前浏览器；清除站点数据前请导出工程和版本备份。AI 请求会发送相关设计内容及参考图到已配置的接口。详细能力、操作说明和限制见 [使用指南](docs/user-guide.md)。

## 开发与验证

```sh
npm test
npm run check
```

浏览器验收需要可选的 Playwright 环境，运行 `npm run test:browser`。安装方式、全部验收命令、模块说明和 GitHub Pages 发布流程见 [开发指南](docs/development.md)。

```text
index.html       编辑器界面
src/             应用模块
styles/          界面样式
scripts/         本地服务、MCP 与检查工具
tests/           单元测试与浏览器验收
downloads/       可独立运行的 MCP 外挂
docs/            使用、开发及原始资料
```

## 更多文档

- [使用指南](docs/user-guide.md)：完整功能、快捷键、导入导出和数据边界。
- [开发指南](docs/development.md)：代码结构、验证环境和发布流程。
- [MCP 接入](docs/mcp.md)：线上外挂、本地编辑器及五种客户端配置。
- [原始需求](docs/design-requirements.md)、[实施计划](docs/implementation-plan.md)、[验收记录](docs/verification.md)。

原始资料与演示视频保留在仓库中，网站仅发布应用资源及 MCP 外挂。授权范围尚未明确，未额外添加开源许可证。
