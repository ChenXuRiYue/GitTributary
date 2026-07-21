# gt-data

GitTributary 的应用级数据门面。业务代码不直接操作物理文件或裸
`(namespace, key, value)`，而是通过 `DataHub` 暴露的明确端口访问数据。

## 交互边界

```text
Core commands/pages ─┐
Plugin host bridge ──┼─> DataHub
Flow runtime ────────┘     ├─ domain repositories
                            ├─ storage::jsonl     -> physical compatibility backend
                            ├─ plugin container  -> opaque payload + quota + lifecycle
                            ├─ run journal       -> bounded segmented JSONL
                            ├─ run results       -> immutable safe projections
                            └─ sync port         -> explicitly syncable namespaces only
```

`DataHub` 不实现 `Deref<Store>`，也不暴露 `store()` / `store_mut()`。新增业务必须选择
一个领域 Repository；确实没有稳定 schema 的本机数据只能使用受策略约束的
`dynamic()` 端口。

`domain` 是业务入口，`storage` 是同一 crate 内的物理实现。应用生产代码不得直接使用
`gt_data::storage`；该模块只为 Repository、同步基础设施和底层集成测试保留。

```text
gt-data/src/
├── domain/                 # 业务语义与稳定 API
│   ├── hub.rs              # DataHub facade
│   ├── settings.rs         # typed repositories
│   ├── flow.rs
│   ├── plugin_data.rs
│   ├── run_journal.rs
│   └── run_result.rs
├── storage/                # JSONL、namespace、policy、sync 等物理实现
└── lib.rs                  # 只把领域 API 作为常规公共入口
```

## 数据域

| 端口 | 数据 | 约束 |
| --- | --- | --- |
| `settings` | 可移植设置 | typed key，允许 Git Sync |
| `workspace` | 当前仓库、设备和绑定 | 本机私有 |
| `flows` | Flow 定义和目录 | typed record，允许 Git Sync |
| `credentials` | Token、SSH 凭证 | Secret，禁止动态 API 和同步 |
| `remote_metadata` | 本机远程仓库元数据 | 本机私有 |
| `profiles` | 数据环境切换 | 显式管理端口 |
| `plugin_data` | 插件 opaque payload | 单插件容器、scope 校验、配额、有界压缩 |
| `plugin_containers` | 安装关联和 orphan 状态 | 仅宿主可见，卸载不删除 payload |
| `run_journal` | run/job/node 生命周期 | CRC32、分段、严格顺序、保留上限 |
| `run_results` | 安全运行结果 | 不可覆盖、1 MiB、无业务 payload |
| `dynamic` | 无稳定 schema 的本机状态/缓存 | 不能写领域数据、Secret 或插件数据 |

## 插件热更新

插件可定义自己的 payload schema，宿主只管理容器、安全、配额和生命周期。安装或升级
会 attach 既有容器，卸载只标记 orphan，重装会重新关联原数据。运行时调用同时绑定
Registry generation；旧 iframe、旧 MessageChannel 和旧调用在热更新后都会失效。

## 运行数据

Journal 和 Result 分开保存：Journal 是追加式事实，Result 是完成后的只读查询投影。
插件 stdout frame 最大 1 MiB，单个插件 Flow 节点结果最大 256 KiB。持久化失败不会把
已经发生的副作用伪装成“执行失败”并诱发重试，而会发布独立的元数据告警事件。

当前运行历史规模下，按最多 1000 个 run 读取有界目录足够。SQLite 只在出现跨大量运行
的筛选、分页或聚合消费者后加入，并且只能作为可删除、可重建的增量查询投影，不能进入 Git。
