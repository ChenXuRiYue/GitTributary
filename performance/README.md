# GitTributary 性能评价体系

性能测试不是重构完成后的临时测速，而是性能相关变更的交付物。每次涉及进程通信、插件加载、Git 操作、文件扫描、启动链路或资源占用的重构，都应运行对应测试并保留一份可追溯报告。

## 评价范围

当前体系覆盖三层：

- 静态性能契约：约束前端不得重新引入重复加载、无界日志查询和无意义 remount 等已知退化模式。
- 核心基准：使用确定性 Git 仓库和附件数据集测量核心读操作与扫描吞吐。
- IPC 基准：测量插件 Host 进程启动、动态库加载、JSON 请求往返、不同载荷大小和连续调用的延迟。

性能判断必须同时观察绝对预算和相对基线。绝对预算回答“用户是否仍可接受”，相对基线回答“本次变更是否造成退化”。只通过其中一项不能证明重构没有性能风险。

## 当前插件通信链路

插件前端和核心不是直接链接 Rust crate。一次插件后端调用会经过：

```text
插件 iframe
  -> MessagePort / MessageChannel
  -> React 主窗口扩展桥
  -> Tauri invoke("extension_call")
  -> Rust extension_call
  -> PluginHostSupervisor
  -> 子进程 stdin/stdout 上的逐行 JSON RPC
  -> gt-plugin-host
  -> libloading 动态加载 cdylib
  -> C ABI（method CString + payload JSON CString）
  -> 插件后端
```

`files.*`、`git.*`、`store.*` 等核心原子能力在 `extension_call` 内执行，不进入插件进程。只有 `backend.invoke` 会继续跨进程进入插件 Host。

当前 IPC 基准覆盖 Host 冷启动、stdio JSON 往返、请求载荷伸缩、动态库加载和插件调用。它没有覆盖 iframe、MessagePort、Tauri WebView bridge、Rust 调度队列与前端渲染，因此报告中的 Host 指标不能称为完整用户端到端延迟。完整链路属于 L3 Tauri E2E 测试，后续应以贯穿各层的 trace ID 分段采集。

现有实现还有两个需要单独压测的架构风险：`PluginHostSupervisor` 用单个互斥锁串行化所有插件调用，并且每次 `backend.invoke` 都会执行一次 `load_plugin`。热态 pipe 很快并不能证明并发或长任务场景没有排队问题。

## APP 性能模型

报告按桌面 APP 的实际体验组织为六个维度：

| 维度 | 关注内容 | 代表指标 |
| --- | --- | --- |
| 启动 | 主程序、插件 Host 和动态库首次可用 | 冷启动耗时、加载耗时 |
| 交互 | 用户动作到界面可用 | p50、p95、p99 延迟 |
| 通信 | Tauri 与插件进程之间的开销 | IPC 往返、序列化时间、载荷字节数 |
| 吞吐 | 大仓库和批量数据处理能力 | 文件数/秒、链接数/秒、操作总耗时 |
| 资源 | 完成操作所消耗的系统资源 | 峰值 RSS、CPU 时间、输出大小 |
| 稳定性 | 多次运行的波动与长尾 | 最大值、标准差、MAD、变异系数 |

总览可以用雷达图表达六个维度，但回归结论必须来自原始指标、预算利用率和同环境趋势，不能只看综合分数。报告中的预算条形图、分位延迟、样本分布和基线差值是主要判断依据。

## 基线原则

性能数据只能在可比环境中比较。操作系统、CPU 架构、runner 类型、Rust/Node 版本、构建模式和 fixture 版本不同的数据，不应直接计算涨跌。

CI 会缓存同一 OS/架构上 `main` 分支最近一次成功报告，并在后续 Pull Request 中自动恢复为候选基线。渲染器只有在 OS、CPU、Node、Rust、runner、构建模式、fixture 和预算版本全部一致时才启用相对回归门禁。Pull Request 同时检查：

1. 指标没有超过用户体验的绝对预算。
2. 指标相对同环境基线没有超过允许的退化比例。
3. 样本波动没有显著扩大，长尾没有被平均数掩盖。

共享 runner 存在抖动。重要结论应使用多轮中位数与 MAD 等稳健统计复核；不能通过任意放宽环境变量来掩盖回归。需要调整预算时，应在变更说明中记录理由和前后报告。

## 运行方式

先以 release 模式构建 IPC 测试需要的插件 Host 和站点插件：

```bash
cargo build --manifest-path src-tauri/Cargo.toml -p gt-plugin-host --release
cargo build --manifest-path plugins/site-publisher/backend/Cargo.toml --release
```

运行完整性能门禁并生成报告：

```bash
npm run perf:ci
```

也可以分层运行：

```bash
npm run perf:contract
npm run perf:rust
npm run perf:attachments
npm run perf:ipc
npm run perf:report
```

`perf:ipc` 生成机器可读指标，`perf:report` 根据性能模型生成供人阅读的报告。CI 会在 Pull Request 和 `main` 分支推送时执行相同流程。

只有性能模型中配置了预算的指标才参与绝对预算和相对基线门禁。`observed.*`
观测指标会在报告中显示当前值、基线和变化比例，但始终保持 `OBSERVE`，避免共享
runner 的非门禁指标波动误伤 CI；需要把观测指标升级为门禁时，应先在
`performance/model.json` 中为它定义预算。

相对回归还必须超过固定最小差值与绝对预算的 10% 两者中的较大值。这样保留
20% 相对回退规则的同时，不会把远低于绝对预算的毫秒级共享 runner 抖动判为
产品性能回退。

需要和同环境历史结果比较时，把基线文件传给总编排器：

```bash
GT_PERF_BASELINE=performance/baselines/darwin-arm64.json npm run perf:ci
```

渲染器也可单独使用 `--baseline <metrics.json>`。环境指纹不一致时，报告会拒绝计算涨跌，而不是输出没有意义的百分比。

## 报告目录

本地和 CI 的生成结果位于：

```text
performance/reports/latest/
├── metrics.json  # 机器可读的原始指标、环境、预算和判定
├── report.md     # GitHub Job Summary 与代码审查使用
└── report.html   # 图表化完整报告
```

`performance/reports/` 是生成目录，不提交到 Git。CI 无论门禁成功或失败都会尝试上传 `latest` 目录，并将 Markdown 报告写入 Job Summary。长期基线应保存为独立的 CI artifact 或专用历史存储，不要手工覆盖本地报告冒充基线。

当前尚未自动化的 E2E、排队、长稳等预算会明确显示为 `NO DATA`，并把报告总状态标为 `INCOMPLETE`，但不会阻断已覆盖场景的 CI。涉及这些未覆盖链路的性能重构，在相应基准补齐前不能只凭现有绿色门禁宣称性能验收完成。

性能相关 Pull Request 至少应附上报告 artifact，并在变更说明中记录测试环境、受影响场景、关键指标前后差值、预算结论和仍未覆盖的风险。
