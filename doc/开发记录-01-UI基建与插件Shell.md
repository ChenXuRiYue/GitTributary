# 开发记录 01 · UI 基建与插件 Shell

> 阶段：从空脚手架到「可运行的 macOS 风格插件 Shell 原型」。
> 模式：Vibe Coding（对话式增量开发，人审查 + AI 实现）。
> 技术栈：Tauri v2 + React 19 + TypeScript + Vite 7 + Tailwind v4 + shadcn/ui。

---

## 一、本阶段目标

把项目从 `create-tauri-app` 的默认 greet 示例，推进到一个**插件化外壳（Plugin Shell）原型**：
左侧插件按钮侧边栏 + 右侧操作面板，纯前端、可扩展、有 macOS 质感。逻辑暂不接。

---

## 二、时间线与决策

### 1. 文档软链接接入
- 把个人笔记仓库中的 `开源项目/GitTributary` 目录软链接到代码仓库的 `doc/` 下，
  方便开发时直接在 IDE 内查阅产品 / 调研 / 开发文档。
- 命令：`ln -s "<note>/开源项目/GitTributary" doc/GitTributary`。
- ⚠️ 该软链接指向绝对路径、是本机私有笔记，**不入版本库** → 已加入 `.gitignore`（`doc/`）。

### 2. 插件 Shell 原型（第一版，自绘 CSS）
- 设计「插件注册表」结构：`PluginDescriptor { id, name, description, icon, panel }`。
- 注册表 `registry.ts` 用一个数组描述所有插件，**新增功能只需追加一个对象**，
  侧边栏与内容区自动渲染，不改布局代码 —— 这是整个前端可扩展性的基石。
- 占位插件：备份 / 复习 / AI / 数据库 / 设置。
- 第一版用手写深色 CSS（`App.css`）。审查结论：**能跑，但偏丑**，决定引入正规 UI 体系。

### 3. UI 选型：对照产品文档的历史结论
- 翻阅 `开发文档/2.最小化开发.md`：当时结论是「**重点基于 mac 生态，保留扩展 Windows 的余地，
  基于 AI 实现组件替换，控制发展**」，首发平台 macOS。但未钦定具体组件库。
- 落地选型对比（macOS 味道 × 主流 × 可控）后选定 **Tailwind CSS + shadcn/ui**：
  组件源码复制进仓库、完全可改，最契合「AI 替换组件、控制发展」的理念，且不锁死跨平台。
- 产出 `vibe-coding/全局UI规范.md`（语义 token、圆角、SF 字体、阴影、毛玻璃、明暗模式、组件约定）。

### 4. 接入 Tailwind v4 + shadcn/ui
- 安装：`tailwindcss@4` + `@tailwindcss/vite` + `@types/node`，
  运行时依赖 `class-variance-authority / clsx / tailwind-merge / lucide-react` +
  `@radix-ui/react-{slot,scroll-area,separator,tooltip,switch}` + `tw-animate-css`。
- 配置：
  - `vite.config.ts` 加 `tailwindcss()` 插件 + `@ → ./src` 别名。
  - `tsconfig.json` 加 `baseUrl` + `paths`。
  - `components.json`（new-york 风格、lucide 图标、cssVariables）。
  - `src/index.css`：oklch 语义 token + `.dark` + 自定义 `glass` 毛玻璃工具类，`main.tsx` 引入。
  - `src/lib/utils.ts`：`cn()`。
- **坑 1 · shadcn CLI 挂起**：`npx shadcn add` 在非 TTY 下因 React 19 peer 依赖交互提示而卡死、无输出。
  → 改为**手写组件源码**（button/card/input/textarea/badge/separator/scroll-area/switch/tooltip）。
- **坑 2 · npm EACCES**：`~/.npm` 缓存有 root 权限文件导致安装失败。
  → 用 `npm_config_cache=/tmp/gt_npmcache` 前缀绕过（根治：`sudo chown -R 501:20 ~/.npm`）。
- 用 shadcn 组件重写 `panels.tsx` 与 `App.tsx`，删除旧 `App.css`。`npm run build` 通过。

### 5. 主题：改为干净的 macOS 白色主题
- `:root` 调成纯白内容区 `oklch(1 0 0)` + 浅灰半透明边栏，边框更淡，主色保留 macOS 系统蓝。
- 同步更新 `全局UI规范.md`：默认主题 = 浅色（白），`.dark` 保留为可选。

### 6. 侧边栏分区
- `PluginDescriptor` 增加 `category: "extension" | "system"`（缺省 extension）。
- 注册表导出 `extensionPlugins` / `systemPlugins` 两个选择器。
- 布局：**上部扩展插件区**（可滚动，后续支持可选安装）+ **底部固定系统按钮区**（设置）。
- 设计意图：系统功能（设置、未来的账户 / 关于）固定在底，扩展插件在上，符合主流编辑器（VSCode / Obsidian）的边栏心智。

### 7. 侧边栏可收缩 + 更简洁单调
- 增加 `collapsed` 状态：收起 `w-14`（仅图标，hover tooltip 补名）↔ 展开 `w-52`（图标 + 文字）。
- 顶部加收缩 / 展开按钮（`PanelLeft` / `PanelLeftClose`），200ms 宽度过渡。
- 选中态去掉蓝色高亮，改低饱和灰底（`bg-sidebar-accent`）+ 加粗，整体更素净。

### 8. 侧边栏可手动拖拽调宽 + 下限
- 右边缘加拖拽把手（`cursor-col-resize`，hover 透出淡蓝）。
- 边界常量：`MIN_WIDTH=180` / `MAX_WIDTH=360` / `DEFAULT_WIDTH=208` / `COLLAPSED_WIDTH=56` /
  `COLLAPSE_THRESHOLD=140`（拖到此以下自动收起）。
- 双击把手重置默认宽度；拖拽中临时关闭过渡动画并禁用文本选中，保证跟手。

---

## 三、最终代码结构

```
src/
├── index.css              # 全局 token / 明暗 / glass / base
├── main.tsx               # 引入 index.css
├── App.tsx                # 插件 Shell：可收缩 + 可调宽侧边栏 + 主面板
├── lib/
│   └── utils.ts           # cn()
├── components/
│   └── ui/                # shadcn 组件（手写源码，可改）
│       ├── button.tsx  card.tsx  input.tsx  textarea.tsx
│       ├── badge.tsx   separator.tsx  scroll-area.tsx
│       ├── switch.tsx  tooltip.tsx
└── plugins/
    ├── types.ts           # PluginDescriptor + category
    ├── registry.ts        # plugins[] + extension/system 选择器
    └── panels.tsx         # 5 个占位面板
components.json            # shadcn 配置
vite.config.ts            # tailwind 插件 + @ 别名
tsconfig.json             # baseUrl + paths
```

---

## 四、关键设计决策与理由

| 决策 | 理由 |
| --- | --- |
| 插件注册表数组驱动 UI | 新增功能零布局改动，契合「注重扩展与生态」的产品原则 |
| Tailwind + shadcn（组件入仓） | 主流 + 源码可控，契合「基于 AI 替换组件、控制发展」 |
| 语义 token（oklch） | 明暗一致、禁止硬编码色值，规范可持续 |
| 扩展区 / 系统区分离 | 对齐 VSCode/Obsidian 心智，为「可选安装插件」留入口 |
| 侧边栏可收缩可调宽 | 简洁优先、空间可控，符合「极少数界面但高要求」 |

---

## 五、踩坑速查

1. **桌面窗口打不开**：多为首次编译慢，或反复杀进程留下孤儿 `cargo` 死锁在 `~/.cargo/.package-cache`。
   清理僵死 cargo 进程即可。详见《开发调试与启动指南》。
2. **shadcn CLI 卡死**：非 TTY + React 19 peer 交互 → 手写组件源码。
3. **npm EACCES**：`~/.npm` root 权限 → `npm_config_cache=/tmp/...` 或 `chown`。

---

## 六、验证

- `npm run build`（`tsc && vite build`）每步均通过，产出 `dist/`。
- 纯 UI 预览用 `npm run dev`（最快）；完整桌面用 `npm run tauri dev`。

---

## 七、下一步候选

- 接真实逻辑（M1）：选目录 → 读 Git 状态 → 一键提交备份（Rust 端 `git2`）。
- 「可选安装插件」入口：扩展区底部「+ 添加插件」→ 插件管理 / 市场面板。
- 布局持久化：把 `collapsed` / `width` 存 localStorage。
- 暗色模式切换开关。
- 提交规范工具化：commitlint + husky + lint-staged。
