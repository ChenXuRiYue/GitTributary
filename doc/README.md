# doc/

本目录存放项目文档。

## 外部笔记软链接

`doc/GitTributary` 是一个**本机软链接**,指向个人笔记仓库中对应的文档目录:

```bash
# 建立方式（按你的实际笔记路径替换）
ln -s "<你的笔记路径>/开源项目/GitTributary" doc/GitTributary
```

该软链接已被 `.gitignore` 忽略(因为是绝对路径、本机私有),
clone 项目后需手动创建,或跳过——不影响构建与运行。
