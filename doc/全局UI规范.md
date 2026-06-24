# GitTributary 全局 UI 规范（macOS 风格）

> 本文是项目前端的统一视觉与组件规范。所有界面、插件主视图、新组件都应遵循本规范。
> 目标：做出克制、精致、有 **macOS 原生味道** 的界面，同时保留跨平台（Windows）的演进余地。

---

## 一、技术选型（已定）

| 项 | 选择 | 说明 |
| --- | --- | --- |
| CSS 引擎 | **Tailwind CSS v4** | 通过 `@tailwindcss/vite` 插件接入，无需 `tailwind.config.js`，token 写在 CSS 里。 |
| 组件库 | **shadcn/ui**（`new-york` 风格） | 组件源码复制进仓库（`src/components/ui/`），完全可改 —— 契合「基于 AI 替换组件、保留细节、控制发展」。 |
| 图标 | **lucide-react** | 线性图标，风格统一、体量轻。 |
| 工具函数 | `cn()`（`clsx` + `tailwind-merge`） | 位于 `src/lib/utils.ts`，所有组件合并 className 用它。 |

**理念**：先做出 macOS 质感；跨平台不是现在的目标，但不锁死后路。组件源码在手，未来可按平台分叉或让 AI 替换。

---

## 二、设计 token（落地于 `src/index.css`）

token 用 CSS 变量定义，并通过 `@theme inline` 暴露给 Tailwind 工具类（`bg-background`、`text-muted-foreground` 等）。颜色采用 **oklch**，明度过渡更线性。

### 配色（语义化，禁止在组件里写死十六进制色值）

| Token | 用途 |
| --- | --- |
| `background` / `foreground` | 页面底色 / 主文字 |
| `card` / `card-foreground` | 卡片、面板区块 |
| `popover` / `popover-foreground` | 浮层、下拉 |
| `primary` / `primary-foreground` | 主操作色（**macOS 系统蓝**） |
| `secondary` / `muted` / `accent` | 次要、弱化、强调底色 |
| `muted-foreground` | 次要文字、说明文案 |
| `destructive` | 危险/删除操作（红） |
| `border` / `input` / `ring` | 描边 / 输入框边框 / 焦点环 |
| `sidebar*` | 侧边栏专用一组（半透明边栏质感） |

> 用法：`className="bg-card text-card-foreground border"`，永远走语义 token，不写 `bg-[#xxxxxx]`。

### 圆角（偏大，macOS 观感）
- 基准 `--radius: 0.625rem`（10px）
- 工具类：`rounded-sm / rounded-md / rounded-lg / rounded-xl`（基于基准换算）
- 卡片/面板用 `rounded-xl`，按钮/输入用 `rounded-md` 或 `rounded-lg`。

### 字体（SF 字体栈）
```
-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
"PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif
```
- 通过 `--font-sans` 暴露，body 默认启用。
- 开启 `-webkit-font-smoothing: antialiased`，更接近原生渲染。

### 间距
- 沿用 Tailwind 间距刻度（4px 基准）。
- 面板内边距推荐 `p-4`～`p-6`；区块间距 `gap-4`～`gap-5`。

### 阴影
- macOS 阴影柔和、低对比。优先 `shadow-sm` / `shadow-md`，避免重黑硬阴影。

### 毛玻璃（macOS 标志性）
- 自定义工具类 `glass`（`src/index.css` 中 `@utility glass`）：半透明 + `backdrop-filter: saturate(180%) blur(20px)`。
- 用于侧边栏、顶部栏、浮层等需要「透出底层」的表面。

---

## 三、明暗模式

- **默认主题：干净的 macOS 浅色（白）** —— 内容区纯白 `oklch(1 0 0)`，侧边栏浅灰半透明形成层次。
- 亮色为 `:root`，暗色为 `.dark` 类（`@custom-variant dark` 已配置，作为可选项保留）。
- 切换方式：在根元素 `<html>` 或 `#root` 上增删 `dark` 类。
- **所有颜色必须同时在亮/暗下成立** —— 用语义 token 自动满足，禁止硬编码颜色绕过。

---

## 四、布局规范

### 核心原则：水平大于垂直

信息密度小但列表长的内容（提交历史、文件列表等），采用**左右水平分栏**而非上下堆叠。理由:
- 纵向滚动是最自然的阅读方式,留给长列表本身
- 左右分栏可以同时展示「索引」和「详情」,无需来回跳转
- 避免垂直堆叠导致内容被挤到视口外,需要反复上下翻

**适用场景:**
- 提交历史：左侧 commit 列表 | 右侧文件变更 + diff
- 文件变更：左侧文件树 | 右侧 diff 预览
- 分支管理：左侧分支列表 | 右侧分支详情（如果有）
- 凡是「选中某项 → 查看详情」的模式,一律左右分栏

**不适用:**
- 频繁操作区（输入框/按钮）放顶部,它的信息量小、交互频率高,适合水平条状
- 纯内容阅读（如大段 markdown 预览）适合单列纵向

### 分栏伸缩与磁吸（Snap）

所有可拖拽分栏统一使用 `ResizeHandle` 组件,遵循以下规则:

- **有下限无上限**:每个分栏设置合理的 `minSize`(不能拖到消失),不设上限(内容多时可以尽情拉宽)
- **预设磁吸值（snapTo）**:每个分栏有一个「默认宽度」,拖拽接近该值(±8px 阈值)时**自动吸附**,产生"磁铁感"/"预设感"。这让用户感知到"这是推荐尺寸",同时自由调整不受限
- **双击重置**:双击分隔条恢复到预设值(snapTo)
- **全局一致**:任何出现分栏的地方都用同一套 ResizeHandle + 磁吸行为,交互统一

| 分栏位置 | minSize | snapTo(预设) | 说明 |
| --- | --- | --- | --- |
| DiffPanel 文件列表 | 140px | 220px | 文件树默认宽度 |
| HistoryView 提交列表 | 180px | 256px | 提交列表默认宽度 |
| 主侧边栏(展开态) | 180px | 208px | 已有,见 App.tsx |

后续新增的分栏都按此规则设定。

### 溢出折叠（Pin + Overflow）

侧边栏、工具栏等有限空间的图标/按钮列表,统一使用「固定 + 折叠」模式:

- **固定区（Pinned）**:高频操作项直接展示,始终可见可点击
- **折叠区（Overflow / More）**:低频操作项收入 `...` 按钮后面,点击展开,再次点击或选中后收起
- **可配置**:每个项通过 `pinned: boolean` 字段决定归属,用户后续可自定义顺序和分组
- **全局复用**:Git 二级栏、主侧边栏(如果插件多了)、工具栏弹窗等凡是「有限空间 + 项可能很多」的场景都用此模式

视觉表达:
- 固定区和折叠区之间有一条**细分隔线**,与 `...` 按钮共同暗示"下面还有更多"
- `...` 按钮点击后,归档项以同样的图标样式展开在分隔线下方(不用弹窗/下拉,保持内联)
- 归档区选中某项后,该项高亮保持,归档区可以保持展开(用户正在使用它)

设计意图:
- 避免侧边栏/工具栏因项目过多而变得臃肿
- 频繁操作零跳转,低频操作一击即达(不是藏在深层菜单里)
- 给用户「这里还有更多能力」的暗示,而非完全隐藏

### 滚动隔离(强制规则)

**每个滚动区域必须在自身容器内独立滚动,不允许冒泡到外层导致整个 APP 晃动。**

规则:
- `body` 设置 `overflow: hidden; overscroll-behavior: none;` — APP 级禁止滚动
- 每个视图面板的根容器必须有 `h-full overflow-hidden` — 切断滚动传播
- 实际需要滚动的区域(文件树/diff 预览/列表)用 `ScrollArea`(Radix) 或 `overflow-y-auto overscroll-contain` — 在内部独立滚动
- `overscroll-contain` 阻止滚动链(到达边界时不会冒泡到父容器)
- 禁止嵌套滚动容器(ScrollArea 内部不再套 overflow-y-auto)

检查清单(新建视图时):
1. 视图根 `<div>` 是否有 `h-full overflow-hidden`?
2. 需要滚动的子区域是否用了 `ScrollArea` 或 `overflow-y-auto overscroll-contain`?
3. 不滚动的固定区域(顶栏/工具条)是否在 flex 布局中用 `shrink-0` 固定?
4. 是否有嵌套的 ScrollArea?→ 去掉外层的,让内层自己管

### 插件 Shell

整体沿用产品定位的「侧边栏 + 主视图」结构：

整体沿用产品定位的「侧边栏 + 主视图」结构：

```
┌────────────┬─────────────────────────────────┐
│  Sidebar   │  Content                         │
│ (glass)    │  ┌ Header: 标题 + 描述 ────────┐ │
│  品牌 logo │  ├ Body: 插件主视图 ───────────┤ │
│  插件按钮  │  │  卡片 / 列表 / 表单          │ │
│  列表      │  └─────────────────────────────┘ │
└────────────┴─────────────────────────────────┘
```

- **侧边栏**：使用 `bg-sidebar` + `glass` 质感；选中项用 `sidebar-primary` 高亮；图标走 lucide。
- **主视图**：顶部 Header（标题 `text-lg/xl 半粗` + 描述 `text-sm text-muted-foreground`），下方内容区可滚动。
- **manifest 驱动**：主视图类型由插件 manifest 的 `ui.mainView.type` 决定（FormView / ListView / CustomView），布局组件不硬编码具体插件。

---

## 五、组件使用约定

1. **优先用 shadcn 组件**：Button、Input、ScrollArea、Separator、Tooltip、Card、Dialog 等，统一从 `@/components/ui/*` 引入。
2. **新增组件**：用 `npx shadcn@latest add <name>` 拉取到 `src/components/ui/`，再按需微调。
3. **业务组件**放 `src/components/`，插件面板放对应插件目录。
4. **className 合并**一律用 `cn(...)`。
5. **图标**统一 lucide-react，尺寸默认 16/18/20，跟随文字色（`text-*`）。
6. **不引入**第二套组件库或额外 CSS 框架，避免风格割裂。

---

## 六、Do / Don't

**Do**
- 用语义 token（`bg-card`、`text-muted-foreground`、`border`）。
- 圆角偏大、阴影柔和、留白充足。
- 侧边栏/浮层用 `glass` 体现 macOS 质感。
- 亮暗双模式同时验证。

**Don't**
- ❌ 硬编码颜色（`bg-[#1e222b]`、`color: #fff`）。
- ❌ 重黑硬阴影、过小圆角（< 6px）。
- ❌ 混入第二套 UI 库。
- ❌ 在组件里写死字体族，应继承 `--font-sans`。

---

## 七、关键文件索引

| 文件 | 作用 |
| --- | --- |
| `src/index.css` | 全局 token、明暗模式、`glass` 工具类、base 样式 |
| `src/lib/utils.ts` | `cn()` className 合并 |
| `components.json` | shadcn/ui 配置（new-york / lucide / 别名） |
| `src/components/ui/` | shadcn 组件源码（可改） |
| `vite.config.ts` | Tailwind 插件 + `@` 路径别名 |

---

## 八、一句话总结

> 语义 token 驱动、shadcn 组件可控、SF 字体 + 大圆角 + 柔和阴影 + 毛玻璃 = macOS 味道。先精后广，跨平台留后路。
