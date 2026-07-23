# Pages 发布目标

## 边界

站点扫描、构建和 Pages 发布属于 `plugins/site-publisher`。Core 只提供文件、Git、Store、
凭据和 Flow 基础设施，不注册站点构建占位节点。

## 插件能力

```text
site.scan          页面调用的扫描方法
site.build         页面调用的构建方法
site.publish       页面调用的构建、提交和推送方法
flow.site.scan     Flow 扫描节点方法
flow.site.build    Flow 构建节点方法
```

插件安装并活跃后向 Flow 节点池贡献：

- `dev.noteaura.site-publisher/scan@v1`
- `dev.noteaura.site-publisher/build@v1`

构建节点直接调用真实 `na_site::build_site`。Pages 推送暂时由插件页面触发；在 Flow 中开放
发布节点前，需要把目标仓库认证上下文作为受控 host service 注入插件节点。

## 发布流程

```text
扫描源仓库 -> 选择文档 -> 构建静态站点 -> 准备目标仓库
         -> 校验推送权限 -> 写入发布目录 -> commit -> push
```

宿主解析凭据和提交身份后注入插件 backend，不向 iframe 返回 token 或私钥。插件负责目标
规划、站点产物和 Pages 领域错误；Git Core 负责底层仓库操作。

## 当前范围

- 支持本地目标仓库和 GitHub Pages 分支发布。
- 支持 HTTPS token、SSH key 和 Agent。
- Flow 已支持扫描与构建，尚未贡献自动发布节点。
- 公开插件分发和稳定原生 ABI 不在当前范围。
