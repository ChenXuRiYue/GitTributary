# Flow 节点速查

节点目录是运行时巡检结果，不是固定清单。Core 只贡献真实可执行能力，活跃插件通过
`manifest.json > contributes.flowNodes` 贡献领域节点。

## 当前 Core 节点

| uses | 作用 |
| --- | --- |
| `gittributary/files/assert-exists@v1` | 校验文件或目录存在，可选要求非空 |
| `gittributary/files/sync-dir@v1` | 递归复制源目录到目标目录 |
| `gittributary/git/commit-all@v1` | 暂存并提交全部变更 |
| `gittributary/git/push@v1` | 推送指定分支 |
| `gittributary/store/sync-now@v1` | 立即同步数据中心 |

## 当前插件节点

`site-publisher` 安装并活跃后贡献：

| uses | 作用 |
| --- | --- |
| `dev.gittributary.site-publisher/scan@v1` | 扫描可发布内容 |
| `dev.gittributary.site-publisher/build@v1` | 真实构建静态 HTML 站点 |

插件被卸载后，其节点立即从节点池消失，引用它的 Flow 会显示为未注册。

## 示例

```yaml
name: 检查仓库

gt:
  id: flow.check_workspace
  enabled: false

on:
  workflow_dispatch:

jobs:
  check:
    runs-on: gittributary-local
    steps:
      - id: repository
        uses: gittributary/files/assert-exists@v1
        with:
          path: ${{ gt.workspace.active_repo }}
          non_empty: true
```

```yaml
- id: build
  uses: dev.gittributary.site-publisher/build@v1
  with:
    repo_path: ${{ gt.workspace.active_repo }}
    output_dir: /tmp/gittributary-site
    site_title: Notes
    include: '["README.md", "docs"]'
```

