# 规则文档

每条默认规则对应一篇文档，说明检查什么、为什么在统信 UOS / 银河麒麟上会出问题、怎么改，以及判断依据的来源。新增规则时复制 [`_template.md`](./_template.md)。

| 规则 | 说明 | 严重程度 | 验证方式 |
| --- | --- | --- | --- |
| [package-json](./package-json.md) | 工程根目录包含可解析的 package.json | error | local |
| [electron-dependency](./electron-dependency.md) | electron 声明在 devDependencies 且版本明确 | error / warning | local |
| [electron-lifecycle](./electron-lifecycle.md) | Electron 大版本在官方支持窗口内 | warning / info | local |
| [electron-platform-architecture](./electron-platform-architecture.md) | 声明的 Linux 目标架构有 Electron 官方产物 | error / warning / info | local |
| [lockfile](./lockfile.md) | 锁文件存在、唯一，并与 packageManager 一致 | error / warning | local |
| [linux-deb-target](./linux-deb-target.md) | 打包配置包含 Linux DEB 目标 | error / warning / info | local |
| [deb-metadata](./deb-metadata.md) | DEB 元数据齐全：homepage、maintainer、图标、桌面分类、可执行文件名 | error / warning / info | local |
| [product-name-ascii](./product-name-ascii.md) | DEB 包名与可执行文件名只含 ASCII 字符 | error / warning | local |
| [native-module-abi](./native-module-abi.md) | 原生模块的 Linux x86_64 产物及其 glibc / libstdc++ 需求已读出 | warning / info | device / local |

面向用户的全部检测项、UOS / 麒麟厂商硬限制速查与结果语义见[检测项清单](../checks.md)。可选发行版工程规范与独立 DEB 产物规则见 [packaging](./packaging.md)，包含稳定 ID、目标/渠道适用范围、覆盖状态、直接官方来源和解析限制；它们不会加入原有默认九条规则。
