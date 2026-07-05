# 发布检查清单

本文档记录 Git Tributary 首版及后续版本发布前应确认的事项。安装包构建可以由 Flow 自动完成，但发布前仍建议按本清单逐项检查。

## 版本信息

- [ ] `package.json` 版本号正确。
- [ ] `src-tauri/tauri.conf.json` 版本号正确。
- [ ] `CHANGELOG.md` 已新增本次版本说明。
- [ ] README 中的功能说明与当前版本一致。
- [ ] Git tag 名称与版本一致，例如 `v0.1.0`。

## 构建与测试

- [ ] 前端构建通过：`npm run build`。
- [ ] Rust/Tauri 编译或测试通过。
- [ ] 主要模块完成手动烟测：Git、发布、Flow、数据中心。
- [ ] 发布任务不会包含私有笔记或敏感路径。
- [ ] Flow 执行日志没有暴露 token。

## macOS 发布资产

- [ ] 生成 Apple Silicon DMG。
- [ ] 如需支持 Intel Mac，生成 x64 DMG 或 universal DMG。
- [ ] 应用图标、应用名、版本号、bundle identifier 正确。
- [ ] DMG 可打开，应用可拖入 `Applications`。
- [ ] 新安装启动正常，升级覆盖安装正常。

## 签名、公证与校验

- [ ] macOS 应用已使用 Developer ID 签名。
- [ ] DMG 或应用已完成 Apple notarization。
- [ ] staple 结果已验证。
- [ ] Gatekeeper 检查通过。
- [ ] 生成 `SHA256SUMS.txt`。
- [ ] Release 页面中的校验值与本地文件一致。

## 文档

- [ ] `INSTALL.md` 与本次安装包架构一致。
- [ ] `PRIVACY.md` 覆盖新增数据流。
- [ ] `SECURITY.md` 覆盖新增安全报告方式。
- [ ] `LICENSE` 存在且符合项目预期。
- [ ] Release notes 写清楚新增能力、已知限制和升级建议。

## 发布

- [ ] GitHub Release 标题使用版本号，例如 `Git Tributary v0.1.0`。
- [ ] 上传 DMG、校验文件和必要的 updater 元数据。
- [ ] Release notes 包含系统要求、下载建议和已知限制。
- [ ] 下载链接经过验证。
- [ ] 发布后从 GitHub Release 重新下载安装包并完成一次安装烟测。

## 发布后

- [ ] 观察 Issues 和用户反馈。
- [ ] 如发现安全问题，按 `SECURITY.md` 流程处理。
- [ ] 如发现安装包问题，撤回或标记受影响资产，并发布修复说明。
- [ ] 将下一版本计划记录到项目文档或 Issues。
