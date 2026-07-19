# 文档发布 UI / 交互重构草稿

> 状态: 草稿 (Draft) · 需求已对齐，方向待拍板
> 更新时间: 2026-07-04
> 范围: `site` 插件 (`SitePanel`) 的 UI 与交互层重构。默认不改后端命令契约 (`site_scan` / `site_build` / `site_publish_pages`)；"构建结果持久化" 若确认需要，会有一处 store 侧新增 (见第八节 D3)。
> 角色视角: 产品经理 + UI 设计师 + 前端 React 工程师

---

## 一、需求地基 (用户原话抽象)

用户诉求很朴素，核心对象是一个 **发布任务**:

> **发布任务 = { 源仓库, 目标仓库, 选中的 markdown 文件列表 }**
> 可创建、可复用，且 **构建结果被持久化**。

代码里其实已经有这个对象雏形 —— `SiteWorkspaceGroup` (工作区组: `name + sourceRepoPath + publishTargetId + env`)。
问题在于: 这个完整对象当前被**拆散**在 "工作区配置 / 文档捕捉 / Pages 发布" 三个并列 Tab 里分别配置，用户要在多个 Tab 间来回拼装，这正是 "布局凌乱、无逻辑" 的根因。

---

## 二、用户明确的 4 个痛点

| 编号 | 痛点 | 本质 |
| --- | --- | --- |
| 痛点 1 | 布局凌乱、无逻辑 | 一个完整任务对象被切成三片，跨 Tab 拼装 |
| 痛点 2 | 数据源操作不丝滑 (刚进页面要手动刷新才看见候选仓库) | 候选加载时机分散、不可靠 |
| 痛点 3 | 编辑态 / 阅读态不分离 | 这是读多写少的场景，却默认把用户丢进表单 |
| 痛点 4 | 顶栏信息废话多且丑 | 缺统一顶栏规范，信息重复拥挤 |

---

## 三、当前形态回顾 (现状快照)

### 3.1 页面骨架

```text
Header: [工作区] 文档发布 · <当前工作区名>            [工作区切换下拉菜单]
├ IconNav (竖排 40px)
│   工作区配置 / 文档捕捉 / Pages 发布 / 构建结果
└ 主视图 (随 IconNav 切换的单一面板)
```

### 3.2 四个视图职责

| 视图 | 组件 | 职责 |
| --- | --- | --- |
| 工作区配置 | `WorkspaceConfigPanel` | 管理工作区组，绑定源仓库 / 发布仓库 / 环境变量 |
| 文档捕捉 | `CapturePanel` | 扫描源仓库，勾选参与构建的文档入口 |
| Pages 发布 | `PublishTargetPanel` | 选发布仓库、配发布参数、保存目标、一键发布 |
| 构建结果 | `BuildResultPanel` | 展示构建 / 发布报告 |

### 3.3 数据模型 (现状)

- `SiteWorkspaceGroup`: `{id, name, sourceRepoPath, publishTargetId, env[]}` → `sites/workspace.config`
- `SitePublishTargetState`: 发布目标全量配置 → `sites/publish.<sourceRepoHash>`
- `PublishRepoCandidate`: 由 `get_remote_configs` 转换，带 `status` (ready / needs-local / not-recommended)
- `SiteBuildUiState`: 勾选路径与构建参数 → `sites/build.<hash>`
- **构建结果 (`buildReport` / `publishReport`) 目前只存在 React 内存中，未持久化** (与用户 "持久化构建结果" 的诉求有缺口)。

---

## 四、已修复: 痛点 2 的缓存刷新时机 (立即修复，已落地)

### 4.1 根因

候选仓库来自后端 `collect_remote_configs`，依赖 "当前打开的仓库 + `store.active_repo()` + 已绑定仓库"。前端 `remoteConfigs` 的加载时机分散且不可靠:

- `selectSiteView()` 里只有 **主动点击** 切到 workspace/publish 时才 `loadRemoteConfigs()`。
- 但挂载时另有一个 effect 用 `setActiveViewId(cached.activeViewId)` **直接恢复** 上次视图 (绕过 `selectSiteView`)，这条路径不触发加载。
- 初始 effect 的 `await loadRemoteConfigs()` 发生在 `scanRepo` 打开仓库 **之前**；`scanRepo` 内那次是 `void` (不保证顺序，失败分支不执行)。
- 结果: 恢复进入 publish 页 / scan 失败 / 时序错位时，`remoteConfigs` 为空或过期，只能靠手动 "刷新远程配置" 补救。

### 4.2 修复

改为 **视图驱动加载**: 新增一个 effect，只要当前处于需要候选的视图 (workspace / publish)，无论视图是被点击还是被恢复的，都自动 `loadRemoteConfigs()`；同时移除 `selectSiteView` 内重复的加载分支。

```tsx
useEffect(() => {
  if (activeViewId === "workspace" || activeViewId === "publish") {
    void loadRemoteConfigs();
  }
}, [activeViewId, loadRemoteConfigs]);
```

验证: `npx tsc --noEmit` 通过 (退出码 0)。行为不变，仅加载时机变可靠。

---

## 五、重构主张: 以 "发布任务" 为中心 + 读写分离

对应解决痛点 1 / 3 / 4，并把痛点 2 的心智一并理顺。

### 5.1 默认阅读态 (解决痛点 3: 读多写少)

进插件默认看到 **任务只读摘要**，而不是表单:

```text
┌ 个人文档站                                 [编辑] [构建] [发布] ┐
│  源仓库    notes             (main)                             │
│  目标仓库  notes-site         gh-pages / root                   │
│  发布文档  42 个 markdown     ▸ 展开预览                         │
│  最近构建  2h 前 · 42 页 · 成功    ▸ 打开站点 / 输出目录         │
└─────────────────────────────────────────────────────────────────┘
```

平时就是 "看状态 + 一键构建/发布"，零表单噪音。

### 5.2 编辑态是显式进入的独立态 (解决痛点 1: 布局有逻辑)

点 `[编辑]` / `[新建任务]` 才进入配置态，把三件事收敛成一条清晰主线:

```text
① 选源仓库  →  ② 选目标仓库  →  ③ 勾选要发布的文档
```

- 目标仓库 **只此一处配置**，消灭当前 workspace 与 publish 两处选发布仓库的双份状态 (旧 P1)。
- ③ 文档捕捉是最重交互 (树 + 筛选)，保留为独立子面板 / 抽屉。
- 编辑完 `[保存]` 回到阅读态。

### 5.3 顶栏瘦身 (解决痛点 4)

当前顶栏 `[工作区]徽章 + 标题 + 工作区名 + 大下拉` 信息重复且拥挤。建议压成一行:

```text
文档发布   ·   <任务名 ▾ 切换>                          [主操作]
```

- 去掉 "工作区" 徽章与重复的工作区名。
- 任务切换收进任务名旁小箭头，不再占一个大按钮。
- **延伸**: 沉淀一个可复用的 `PluginHeader` 约定 (标题 + 上下文选择器 + 右侧主操作 三段式)，供 Git / 数据中心等插件统一套用，写进 `doc/UI/`。这是用户提到的 "整体顶栏 UI 规范" 的落点。

---

## 六、交互细节草案 (随方向确定后细化)

### 6.1 发布就绪校验 (Readiness)

阅读态与发布区常驻 "还差什么" 的显式提示:

| 检查项 | 未满足提示 | 满足态 |
| --- | --- | --- |
| 源仓库已选 | 去编辑选择源仓库 | ✓ 仓库名 |
| 已勾选文档 | 去编辑勾选文档 | ✓ N 项 |
| 目标仓库可用 | 需 Clone / 绑定本地副本 | ✓ 仓库名 |
| 分支 / 目录 | 补全发布参数 | ✓ branch/dir |

全部满足 → `[发布]` 主按钮高亮可点。

### 6.2 状态收敛 (工程侧，解决旧 P5)

新增 `useSitePublishTask` (hook 或 reducer)，统一托管 `任务列表 / 当前任务 / scanReport / 文档选择 / 发布目标` 及其持久化副作用，`SitePanel` 只做布局与派发，降低耦合。

---

## 七、不做的事 (本次边界)

- 不实现 Flow 自动发布 (归后续里程碑 M4)。
- 不新增 GitHub 远程仓库创建 / Pages API 调用。
- 不引入第二套组件库。
- 除 "构建结果持久化" (若确认) 外，不改后端命令与数据结构。

---

## 八、待拍板的决策点

| 编号 | 决策 | 选项 |
| --- | --- | --- |
| D1 | 对象命名 | "工作区组" 正式改叫 **发布任务** / 保留 "工作区" |
| D2 | 编辑态形态 | 整页分步 Stepper / 阅读态原地展开的编辑抽屉 |
| D3 | 构建结果持久化 | 新增 store 记录 (每任务存最近一次 / 多次构建结果) —— 会牵扯后端/store，属超出纯 UI 的改动，需确认是否本次做 |
| D4 | 多任务 vs 单任务 | 多数一仓一任务 (任务列表做轻) / 常并行多任务 (任务列表做重) |

---

## 九、下一步 (拍板后)

1. 出低保真交互稿 (文字版线框 / 组件树)。
2. 定组件拆分与 props 契约 (含 `useSitePublishTask` 接口)。
3. 分步落地到 React，保证每步可编译、可回归。
4. 若 D3 确认，补 `sites.publish_records` (或复用 `sites` 命名空间) 的读写与 UI 呈现。

---

## 十、术语规范建议 (降噪: 去掉 "捕捉" 这类口语词)

"捕捉 / 捕捉到的文档入口" 偏内部实现视角，不像产品术语。参考静态站点工具 (VitePress / MkDocs / Docusaurus) 的通行说法 (content / sources / scope)，建议统一为下表术语系统:

| 现术语 (难听/含糊) | 推荐术语 | 英文对照 | 说明 |
| --- | --- | --- | --- |
| 工作区 / 工作区组 | **发布任务** | Publish Task | 顶层对象 (呼应 D1) |
| 文档捕捉 (导航/动作) | **文档范围** / 选择文档 | Document Scope | 本质是 "圈定要发布哪些文档" |
| 捕捉到的文档入口 | **候选目录** / 待发布文档 | Candidates | 扫描得到、尚未勾选的项 |
| 目录分级预览 | **发布范围** / 已选文档 | Selected Scope | 右侧已勾选结果 |
| Pages 发布 | **发布** | Publish | 动作即可，不必每处都带 Pages |
| 发布仓库 / 发布目标 / 候选仓库 | **发布仓库** (统一) | Publish Repository | 现三个词指近似概念，收敛成一个 |
| 源仓库 | 源仓库 (保留) | Source Repository | 已规范 |
| 构建结果 | 构建结果 / **发布记录** | Build Result / Record | 持久化后偏向 "发布记录" |

主线一句话: **在「源仓库」里圈定「文档范围」→ 构建 → 发布到「发布仓库」**。

> 已定: 该步骤/区域统一叫 **文档范围** (既作名词 "任务的文档范围"，也作引导动词 "圈定文档范围")，不再用 "内容选择" / "捕捉"。

---

## 十一、文档选择区筛选精简 (降噪: 砍掉无意义搜索/筛选)

`CapturePanel` 顶部当前有 7 个控件，多数把扫描器内部启发式 (score / reason / 推荐 / markdown 计数) 直接暴露成筛选，属噪音。

### 保留 (3 类)

- 树形 / 列表 视图切换。
- 全选 / 默认 / 清空 批量选择。
- **一个轻量名称搜索**，且仅当候选项超过阈值 (建议 > 20) 时才出现。

### 砍掉

| 控件 | 砍掉理由 |
| --- | --- |
| 类型筛选 (目录/文件) | 用户不关心，几乎不用 |
| 选择状态筛选 (已选/未选) | 右侧 "发布范围" 面板已展示已选，重复 |
| 推荐状态筛选 (默认/非默认) | 泄露内部打分概念，用户无感 |
| Markdown 数量筛选 (≥1/3/10) | 极少用的 power-user 过滤 |
| 排序 (分数/md 数量优先) | score 是内部启发式，暴露是噪音；默认按路径排即可 |

### 理由

典型文档仓库的候选就那么几个 (README、doc/、docs/、notes/)，多维筛选无收益、只增加决策负担；`score` / `reason` 是扫描器内部信号，不应出现在用户界面。数据结构层的 `score` / `reason` / `markdownCount` 可保留 (排序/推荐默认勾选仍要用)，只是不再作为用户可见筛选控件。

---

## 十二、任务清单 (执行视图)

> 状态图例: ✅ 已完成 · 🔓 已决策待做 · ⏸ 待拍板 (依赖 D1–D4)

### 已完成

- ✅ **T0 · 缓存刷新时机修复**: 视图驱动加载候选仓库，去掉手动刷新依赖 (`SitePanel.tsx`，`tsc` 通过)。
- ✅ **术语拍板**: "文档范围" 定为唯一叫法。
- ✅ **T1 · 术语替换 (全量文案)**: 全站按术语表替换 (捕捉→文档范围/候选目录、工作区(组)→发布任务、Pages 发布→发布、发布目标/候选仓库→发布仓库、目录分级预览→发布范围)。仅改文案，未动数据结构。全量 grep 确认无残留旧术语，`tsc` 通过。
- ✅ **T2 · 文档范围区筛选精简**: `CapturePanel` 7 控件砍到 3 类 —— 保留 视图切换 / 批量选择 (默认·全选) / 条件出现的轻量搜索 (候选 > 20 才显示)；砍类型、选择状态、推荐状态、md 数量、分数排序及重置按钮与徽章行。`score/reason/markdownCount` 数据保留，仅撤下用户可见筛选。
- ✅ **T3 · 顶栏瘦身**: header 压成单行 `[图标] 文档发布 · <任务名 ▾>`；去掉 "工作区" 徽章与重复任务名行；工作区下拉改为标题旁紧凑切换器 (左对齐菜单)。
- ✅ **T4 · 顶栏三段式约定**: 写入 `doc/UI/Core模块顶栏规范.md`，供 Core 模块复用。
- ✅ **T6 · 发布仓库单一事实来源 (数据 + UI 均已合并)**: 合并 "发布任务" (`SiteWorkspaceGroup`) 与 "发布" (原独立 `PublishTargetPanel` 视图) 为同一对象、同一界面。
  - 数据层: 发布参数 (目标仓库/分支/发布目录/Pages URL/提交信息) 现为 `SiteWorkspaceGroup.target` 字段，取代原来的 `publishTargetId` 弱引用指针；`SitePublishTargetState` 独立存储实体已删除；旧记录 (`sites/publish.<hash>`) 通过一次性迁移合并后清理。
  - UI 层 (首次提交遗漏、二次修正): 独立的 "发布" 导航视图与 `PublishTargetPanel.tsx` 组件已删除；候选列表、发布参数表单、保存/发布按钮、发布结果展示全部并入发布任务详情页 (`WorkspaceConfigPanel.tsx`) 的 "发布仓库" 区块，插在 "源仓库" 与 "环境变量" 之间。导航从 4 项 (发布任务/文档范围/发布/构建结果) 减到 3 项 (发布任务/文档范围/构建结果)。选发布仓库、配参数、保存、发布，现在只有一个入口。
  - `tsc --noEmit` 与 `vite build` 均通过，grep 确认无残留引用。

### 待拍板 (依赖决策点)

- ⏸ **T5 · 读写分离骨架 (阅读态 / 编辑态)**: 依赖 **D2** (Stepper vs 编辑抽屉)。T6 完成后，"编辑态" 现在只需围绕单一 `SiteWorkspaceGroup` 对象设计，范围比之前更小。
- ⏸ **T7 · 状态收敛到 `useSitePublishTask`**: 工程内部重构，随 T5 落地；T6 已经把发布相关状态先行收敛掉一大块，`useSitePublishTask` 现在主要托管 `任务列表 / 当前任务 / scanReport / 文档范围选择`。
- ⏸ **T8 · 构建结果持久化 + 发布记录 UI**: 依赖 **D3** (是否本次做、是否动 store/后端)。
- ⏸ **对象命名最终生效**: 依赖 **D1** (发布任务 vs 工作区)；T1 的替换以此为准。

### 待拍板决策点 (阻塞项)

| 编号 | 决策 | 选项 |
| --- | --- | --- |
| D1 | 对象命名 | 发布任务 / 保留 "工作区" |
| D2 | 编辑态形态 | 整页分步 Stepper / 阅读态原地展开的编辑抽屉 |
| D3 | 构建结果持久化 | 本次新增 store 记录 / 暂不做 |
| D4 | 多任务 vs 单任务 | 一仓一任务 (列表做轻) / 常并行 (列表做重) |

### 建议执行顺序

```text
纯 UI 降噪 (已完成):        T1 → T2 → T3 → T4
数据模型合并 (已完成):      T6
拍板 D2/D3 后做剩余重构:    T5 → T7 → (T8)
```

---

## 附录 · 变更记录

- 2026-07-04: 初稿 (通用两方案 A/B)。
- 2026-07-04: 依据用户 4 个痛点与 "发布任务" 需求地基重写；记录痛点 2 缓存时机修复 (已落地)；方向收敛为 "任务为中心 + 读写分离 + 顶栏瘦身"；开放 D1–D4 决策点。
- 2026-07-04: 新增第十节 (术语规范建议，去 "捕捉") 与第十一节 (文档选择区筛选精简，7 控件砍到 3 类)。
- 2026-07-04: 锁定 "文档范围" 为唯一叫法；新增第十二节任务清单 (T0 已完成，T1–T4 可立即推进，T5–T8 待 D1–D4 拍板)。
- 2026-07-04: 完成 T1 (术语全量替换)、T2 (筛选精简)、T3 (顶栏瘦身)、T4 (`doc/UI/Core模块顶栏规范.md`)；`tsc --noEmit` 通过。对象命名按 "发布任务" 落地 (D1 视为采纳，可回退)。
- 2026-07-04: 完成 T6 数据层合并 (发布仓库单一事实来源)。根因: "发布任务" 里的 `publishTargetId` 只是弱引用指针，真正的发布参数存在独立的 `SitePublishTargetState`，导致用户要选两次同一个仓库。现已合并为 `SiteWorkspaceGroup.target`，`types.ts` / `state.ts` / `publish.ts` / `SitePanel.tsx` / 两个面板组件同步调整，旧独立记录通过一次性迁移合并后清理。`tsc --noEmit` 与 `vite build` 均通过，grep 确认无残留旧字段引用。
- 2026-07-04: 修正遗漏 —— 上一条只合并了数据层，UI 上 "发布" 仍是独立导航视图，用户实际体验仍是 "选两次仓库"。补做 UI 层合并: 删除 `PublishTargetPanel.tsx` 与 "发布" 导航项，候选列表/参数表单/保存与发布按钮/结果展示全部并入发布任务详情页，导航从 4 项减到 3 项。至此发布仓库配置只有一个入口。
- 2026-07-04: 修正第二处遗漏 —— 撤掉独立 "发布" 视图后，"仅构建、不发布" (`runBuild`) 失去了正常入口，只剩"构建结果"视图空状态里的一个隐藏兜底按钮，用户需要先手动切换视图才能看到它，等同于没有入口。已在发布任务详情页的 "任务名称" 操作行加回常驻 `[构建]` 按钮，与 "应用此任务" 并列，不要求先配发布仓库 (`canBuild` 独立于 `canPublish`)。`tsc --noEmit` 与 `vite build` 均通过。
- 2026-07-04: 产品边界再纠正 (用户明确指出) —— "发布任务" 页不应包含任何执行按钮 (构建/发布/保存)，它只负责配置对象 (源仓库、发布仓库、分支、目录、URL、提交信息、环境变量)；真正的执行动作应该在 "构建结果" 页，后者升级为执行工作台。
  - `WorkspaceConfigPanel.tsx` 重写为纯配置表单: 删除构建/保存/发布按钮；选发布仓库候选或改分支/目录/URL/提交信息，直接写回 `group.target`，不再有 "保存" 中间步骤；删除结果展示 (结果不属于配置页)。
  - `BuildResultPanel.tsx` 重建为执行工作台: 当前任务只读摘要 (源仓库/发布仓库/分支/目录，附「编辑配置」跳转) + 就绪校验条 (缺源仓库/文档范围/发布仓库时给出修复入口) + `[构建]` `[发布]` 并列主操作 + 构建结果与发布结果历史展示。
  - 顺带修正一个衍生的状态耦合缺口: 配置页任务列表点选一个任务，现在会自动同步 `repoPath` 并触发扫描，与执行工作台保持同一个 "当前任务" 状态源，不再需要去 Header 菜单里额外点一次 "应用" 才能让执行工作台跟上。
  - `tsc --noEmit` 与 `vite build` 均通过，grep 确认无残留旧字段/函数引用；清理了因此产生的死代码 (`draftFromTarget`)。
- 2026-07-04: 修复两个数据模型 bug (用户反馈: 新建任务看似无法保存; 构建结果总报"没有可执行的发布任务")。
  - 根因: `SitePanel.tsx` 一直靠 `repoPath === group.sourceRepoPath` 字符串反查 "当前发布任务" (`currentWorkspaceGroup`)，而不是直接以 `activeWorkspaceGroupId` 为唯一真源。新建任务时若 `repoPath` 与新任务的 `sourceRepoPath` 不完全一致 (例如仓库为空、大小写、扫描未完成)，反查会失败——任务其实已经写入 store (数据没丢)，但 UI 找不到它，表现为"看似没保存"；同理，执行工作台的 `task` 也来自这次反查，一旦落空就误判"没有可执行的发布任务"。
  - 修正: 删除 `currentWorkspaceGroup` 反查逻辑，全面改为 `activeWorkspaceGroup` (`activeWorkspaceGroupId` 唯一真源)；`repoPath`/`selectedPaths`/`scanReport` 都作为其派生展示状态，切换任务时统一同步。
  - 按用户要求重做数据结构: `SiteWorkspaceGroup` 新增 `documentScope: string[]` (文档范围，随任务保存，不再散落在按仓库路径 hash 命名的独立 key 里) 与 `runHistory: SiteRunRecord[]` (近期若干次构建/发布执行记录，含时间/耗时/成功与否/摘要/commit，上限 `SITE_RUN_HISTORY_LIMIT=10`)。三个数据结构对齐用户描述: ① 发布任务列表 (`workspaceGroups`) ② 各任务当前配置 (`sourceRepoPath` + `documentScope` + `target` + `env`) ③ 近期执行状态 (`runHistory`)。
  - 一次性迁移: 旧的 `sites/build.<hash>` 记录里的 `include` 字段被合并进对应任务的 `documentScope` (旧 key 保留，因为还承载 `outputDir`/`siteTitle` 等尚未迁移的字段)。
  - 顺带修复的衍生问题: 新建任务复用当前仓库时会带上当前已勾选的文档范围，不用重新勾选；删除当前激活任务后正确同步到下一个激活任务 (或清空)；修了一个潜在的"删空后无法再自动建默认任务"的锁死 bug。
  - `BuildResultPanel.tsx` 新增"近期执行"区块展示 `runHistory`；`WorkspaceConfigPanel.tsx` 的任务列表行新增"文档范围 N 项 · 已配/未配发布仓库"提示，方便用户直观确认配置确实已保存。
  - `tsc --noEmit` 与 `vite build` 均通过，grep 确认无 `currentWorkspaceGroup` 残留引用。
- 2026-07-05: 修复"重启后发布任务列表拉取失败、每次都重新创建任务"的真实 bug (用户反馈)。
  - 根因: 一个竞态条件，不是持久化本身的问题 (本地 store 写入本就是同步落盘的)。挂载时有两条并行路径——「从 store 异步恢复任务列表」和「扫描仓库」；"自动创建默认任务" 的 effect 只用 `workspaceGroups.length > 0` 判断是否需要新建，但初次挂载 `workspaceGroups` 初始值是 `[]`。如果 `site_scan` 比 store 读取先返回 (常见)，`scanReport` 变化会立刻触发这个 effect，此时若「从 store 恢复」的 `setWorkspaceGroups(migratedGroups)` 还没被 React 应用，effect 看到的仍是空数组，于是抢先新建一个任务并立即 `persistWorkspaceConfig` **覆盖了刚从磁盘读出来、即将写入的已保存任务列表**——表现为"每次重启都拉取失败、重新创建任务"。
  - 修正: 新增 `workspaceRestoredRef`，在挂载 effect 里完成 store 恢复 (无论成功、为空还是异常) 后才置为 `true`；"自动创建默认任务" 的 effect 门控在 `workspaceRestoredRef.current` 上，关闭竞态窗口。
  - 顺带用同一次修复验证: 本地持久化 (`gt-store`) 本身没有问题，`store_set`/`store_get` 是同步 write-through 的；用户提到的"远程"实际是数据中心模块的 `sync_now` (通过 Git 把 public 命名空间推送到远程配置数据库)，是独立的全局能力，与本次 bug 无关。
- 2026-07-05: 应用户要求，为「发布任务」和「文档范围」两个配置面板分别加保存按钮，语义为把当前编辑草稿整体覆盖写入本地存储；全局远程同步 (`sync_now`) 明确解耦，不在这两个面板里触碰。
  - 交互模式从"编辑即生效"改为"本地草稿 + 手动保存"：`WorkspaceConfigPanel.tsx` 内部新增 `draft` state (随 `activeGroup.id` 切换重新播种，不随其内容变化重播，避免覆盖用户正在编辑的草稿)，任务名/源仓库/发布仓库参数/环境变量的编辑全部只改草稿；`groupsEqual()` 判断草稿是否 dirty；点击「保存」才 `onUpdateGroup` 提交整份草稿。
  - `SitePanel.tsx` 同理：删除了原来对 `selectedPaths` 的去抖自动写回 `documentScope` 的 effect，改为 `documentScopeDirty` (对比排序后的草稿与已保存 `documentScope`) + 显式 `saveDocumentScope()`；`CapturePanel.tsx` 头部加"未保存/已保存"徽章与保存按钮。
  - 切换任务 (`selectWorkspaceGroup`/`applyWorkspaceGroup`/`WorkspaceConfigPanel` 内的 `handleSelectGroup`)、新建任务、删除任务时，若存在未保存草稿，都会 `window.confirm` 二次确认，避免静默丢弃。
  - `tsc --noEmit` 与 `vite build` 均通过 (dist 已清理)；grep 确认两个面板里 `onUpdateGroup`/写入 `documentScope` 的调用点都只落在各自的保存函数里，没有残留的实时写入路径。
