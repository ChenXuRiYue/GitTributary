# GitTributary 测试策略与 TDD 工作流

本文定义测试分层、case 管理、执行入口和新增功能的完成标准。目标不是追求一个孤立的覆盖率数字，而是让行为契约、边界条件、并发语义和性能预算都能自动回归。

## 一、测试分层

| 层级 | 工具 | 主要职责 | 日常入口 |
| --- | --- | --- | --- |
| 前端单元/组件 | Vitest 4、Testing Library | 纯逻辑、Hook、组件交互、错误状态 | `npm run test:unit` |
| 前端性质测试 | fast-check 4 | 路径、树结构、序列化等大输入空间不变量 | 随 `test:unit` 执行 |
| 前端覆盖率 | V8 coverage | 全源码基线与关键模块高门槛 | `npm run test:coverage` |
| 浏览器旅程 | Playwright 1.61、Chromium | 完整 React 应用、Tauri IPC 契约、关键用户动作 | `npm run test:e2e` |
| Rust 单元/集成 | Rust test、nextest | crate 内部逻辑和公开 API 契约 | `npm run test:rust:nextest` |
| Rust 性质测试 | proptest 1.11 | JSON、文件路径、Flow 文本、持久化随机验证与失败缩减 | 随 Rust 测试执行 |
| Rust 覆盖率 | cargo-llvm-cov | Rust workspace 的 LCOV 报告 | CI |
| 微基准 | Criterion 0.7 | 算法与序列化的分布、吞吐和趋势分析 | `npm run bench:rust` |
| 性能硬门禁 | 确定性 fixture、p50/p95/max、IPC 报告 | 用户预算和相对基线回归 | `npm run perf:ci` |
| 变异测试 | cargo-mutants | 检查断言是否真正能杀死错误实现 | 每周 CI / 手动触发 |

Criterion 是开发期趋势工具，不能替代现有性能门禁。共享 runner 上的微小纳秒差异不应直接阻断合并；确定性 fixture 的绝对预算和同环境基线才负责性能验收。

## 二、标准工作流

日常最快反馈：

```bash
npm run test:fast
```

合并前完整验证：

```bash
npm run test:all
```

只修改前端时，保持 watch 模式：

```bash
npm run test:unit:watch
```

首次运行 E2E 需要准备浏览器：

```bash
npm run test:e2e:install
```

## 三、TDD 循环

1. Red：先写一个从用户行为或公开 API 出发的失败 case，确认它因为缺少目标行为而失败。
2. Green：只实现让当前行为成立的最小改动，同时运行相邻测试。
3. Refactor：消除重复、改善边界，再运行 `test:fast`。
4. Hardening：为边界、失败、取消、乱序响应和安全输入补 case；适合输入空间的逻辑增加 fast-check/proptest 不变量。
5. Delivery：运行覆盖率、E2E；涉及 Git、扫描、IPC、并发或缓存时额外运行 `perf:ci`。

修 bug 时先提交能稳定复现的回归 case。测试名称描述可观察行为，不复述函数实现；测试失败信息应能让维护者直接定位破坏的契约。

## 四、Case 组织规则

- 前端测试和源码共置为 `*.test.ts(x)`，便于重构时一起移动。
- 浏览器旅程集中在 `e2e/`，只保留跨组件、跨 IPC 的高价值动作。
- Rust 白盒单测放 `src` 内，公开契约和性质测试放 crate 的 `tests/`。
- 性能 case 使用确定性 fixture；不得读取开发者真实仓库、凭据或机器私有路径。
- 优先查询可访问角色、名称和用户可见文本，不依赖 CSS 层级或生成 class。
- Mock 只放在系统边界：Tauri IPC、文件系统临时目录、Git fixture。不要 mock 被测模块内部函数。
- 每个并发读取至少考虑成功、失败、取消/过期和乱序响应。

fast-check/proptest 失败时会自动缩减反例。生成的 regression seed 应提交，除非失败来自错误的测试前提且已经由更明确的固定 case 取代。

## 五、覆盖率策略

V8 报告统计全部业务源码，不通过排除大型页面制造虚高数字。当前采用双层门禁：

- 全局门槛锁住现有真实基线，防止总覆盖率倒退。
- 已建立细粒度测试的工具、扩展桥和通用组件执行 75% 到 100% 的高门槛。
- 大型页面的用户动作同时由 Playwright 覆盖；后续拆分逻辑时应把可测试逻辑下沉并提高全局门槛。

覆盖率阈值只能随新增 case 上调。确需下调时必须在 PR 中说明丢失的行为、原因和恢复计划，不能为了让 CI 变绿直接修改数字。

## 六、稳定性与失败处理

- Vitest、nextest 和性能硬门禁不自动重试；确定性测试失败就应修复。
- Playwright 在 CI 最多重试两次，并保留首次失败的 trace、截图和视频。出现“重试才通过”仍按 flaky case 处理。
- 禁止用固定 sleep 等待异步行为；使用可观察状态、事件或条件轮询。
- 测试不得依赖执行顺序、系统语言、真实时间或共享目录。需要时间时使用固定时间或只断言稳定格式。
- 性能门禁不得通过降低 fixture、放宽预算或重复运行挑最好结果来规避失败。

## 七、新功能完成标准

一个重要功能进入完成状态前至少满足：

1. 正常路径和主要失败路径都有自动化 case。
2. 输入解析、路径、安全边界或状态机存在时，有边界表格或性质测试。
3. 前后端命令名和 DTO 变化有契约测试，相关 E2E fixture 同步更新。
4. 异步读取验证旧响应不会覆盖新状态。
5. 新增关键纯逻辑达到所属目录的高覆盖率门槛。
6. 性能敏感改动提供变更前后报告，并通过绝对预算和相对基线。
7. `test:fast`、插件测试、E2E 和对应性能门禁全部通过。

## 八、统一测试报告

统一入口在测试结束后生成 `test-reports/latest/results.json`、`report.md` 和 `report.html`，并保留每个套件的原始日志。任一套件失败后仍会继续采集其他结果，最后以非零退出码表示总体失败。

| 命令 | 范围 | 适用场景 |
| --- | --- | --- |
| `npm run test:report` / `npm run test:fast` | 类型、前端、Rust 核心 | 日常快速反馈 |
| `npm run test:report:standard` | 快速集 + 插件 + E2E | 普通功能交付 |
| `npm run test:report:full` / `npm run test:all` | 标准集 + 完整性能门禁 + 前端覆盖率 | 重要合并前验收 |
| `npm run test:report -- --only frontend` | 仅前端 | 修改 React/纯逻辑时 |
| `npm run test:report -- --only rust,plugins` | 仅 Rust 核心和插件 | 修改后端时 |
| `npm run test:report -- --only e2e` | 仅 Playwright | 修改关键用户旅程时 |
| `npm run test:report -- --only performance` | 仅性能门禁 | 修改 Git、IPC、扫描或缓存时 |

`--only` 和 `--skip` 都支持逗号分隔的 `types,frontend,rust,plugins,e2e,performance`；`--output` 可为并行任务指定独立目录；`--rust-runner auto` 在本地没有 nextest 时回退到 `cargo test`。

CI 不串行重跑整套测试。前端、Rust、E2E 和性能 job 并行生成结构化分片，最后的 `report` job 使用 `--merge-dir` 合并分片、写入 GitHub Job Summary，并上传包含 Markdown、HTML、JSON 和原始日志的 artifact。如果上游在安装或编译阶段就失败，汇总报告会标记 `INFRA_ERROR`，不会误报成 0 个 case 通过。

`cargo-mutants` 仍作为独立的每周深度检查，不阻塞日常本地循环和 Pull Request。
