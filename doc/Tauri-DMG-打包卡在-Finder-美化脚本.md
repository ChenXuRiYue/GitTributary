# Tauri DMG 打包卡在 Finder 美化脚本

## 背景

macOS 下执行 Tauri 正式打包时,正常命令是:

```bash
npm run tauri build
```

按官方流程,这个命令会先构建前端和 Rust release 产物,再生成 macOS `.app` 与 `.dmg`。

本次遇到的问题是: `.app` 已经成功生成,但 `.dmg` 阶段失败或卡住。

## 现象

Tauri 终端输出只显示较泛化的错误:

```text
Bundling Git Tributary_0.1.0_aarch64.dmg
Running bundle_dmg.sh
failed to bundle project error running bundle_dmg.sh
```

手动测试 Finder AppleScript 时,出现进程被挂起:

```text
[3]  + 32480 suspended  osascript -e 'tell application "Finder" to activate'
```

多次失败后,构建目录里还会残留临时 DMG:

```text
src-tauri/target/release/bundle/macos/rw.*.dmg
```

这些残留文件会被下一次 DMG 打包误当成源内容一起塞进新镜像,可能进一步触发:

```text
设备上无剩余空间
```

## 根因

Tauri 的 macOS DMG 阶段不只是压缩文件。它会调用系统工具创建磁盘镜像,还会通过 AppleScript 控制 Finder,把 DMG 打开后的窗口做成更像正式安装包的布局。

典型美化动作包括:

- 设置 DMG 窗口大小和位置
- 设置图标大小
- 把 `.app` 放在左侧
- 把 `Applications` 快捷方式放在右侧
- 隐藏 `.app` 扩展名
- 设置卷图标或背景

也就是说,DMG 美化阶段依赖:

```text
hdiutil + osascript + Finder + 当前 shell/终端的 GUI 自动化能力
```

本次真正的问题不是 Tauri 代码坏了,而是 shell 环境使用了 `kiro-zsh` 后,`osascript` 这类 GUI 自动化进程会被 shell job control 挂起。于是 Tauri 在 DMG 的 Finder 美化阶段卡住或失败。

切回 macOS 原厂终端环境后,同样的打包流程可以成功。

## 判断方法

先确认 `.app` 是否已生成:

```bash
ls -lh "src-tauri/target/release/bundle/macos/Git Tributary.app"
```

检查是否有失败残留:

```bash
find src-tauri/target/release/bundle -maxdepth 3 -name 'rw.*.dmg' -print
```

测试 AppleScript 本身:

```bash
osascript -e 'return 1 + 1'
```

如果这条成功,说明 `osascript` 本体没坏。

继续测试 Finder 控制链路:

```bash
open -a Finder
osascript -e 'tell application "Finder" to activate'
```

如果这里出现 `suspended`、卡住,或 Finder 相关错误,说明问题集中在 Finder 自动化链路,不是前端/Rust 编译问题。

## 解决方案

优先使用稳定的原厂终端环境重新打包:

```bash
cd /Users/mi/rust_code/GitTributary
rm src-tauri/target/release/bundle/macos/rw.*.dmg
npm run tauri build
```

如果使用 iTerm,确认不是 shell 定制层导致 `osascript` 被挂起。必要时切回原厂 shell 或 macOS Terminal 验证。

如果只是需要稳定发布产物,可以使用不依赖 Finder 美化的备用打包命令:

```bash
npm run package:mac
```

这个命令保留正式分发需要的 `.dmg`,但不运行 Finder 窗口美化脚本,因此更适合自动化环境或 CI。

## 经验

遇到 Tauri macOS DMG 打包失败时,不要只看最后一行 `bundle_dmg.sh failed`。要把它拆成三层看:

1. `.app` 是否已经成功生成
2. `hdiutil` 是否能创建/压缩磁盘镜像
3. `osascript` 是否能正常控制 Finder

如果只有 DMG 阶段失败,且 `osascript` 被挂起,优先怀疑终端/shell 环境,而不是 Tauri 配置或应用代码。
