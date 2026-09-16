# 检测项清单

doctor 的全部检测项按三层组织，每条结果都带**稳定规则 ID**、严重程度（error / warning / info）、验证方式（local / device）和实际证据。当前规则集版本：`2026-09-16.1`。

| 层 | 触发方式 | 检查对象 |
| --- | --- | --- |
| 默认工程检查 | 无参数 | 工程配置与 `node_modules`，9 条通用交付规则 |
| 目标规范工程检查 | `--target`（可加 `--channel`） | 打包配置，6 条 `packaging-*` 规则 |
| DEB 产物检查 | `inspect <文件.deb>` | 最终 DEB 包，10 条 `deb-*` 规则 |

每条规则的官方来源、核对日期与冲突记录见 [docs/rules/packaging.md](./rules/packaging.md)（目标规范与产物检查）和 [docs/rules](./rules/README.md)（默认 9 条的逐条背景）。

## 统信 UOS 商店硬限制

适用条件：`--target uos-v20 --channel store`，产物架构 amd64（其他架构标记为范围外）。以下为 **error 级硬限制**，任一命中即退出码 1：

| # | 硬限制 | 规则 |
| --- | --- | --- |
| 1 | 包名为小写倒置域名，如 `com.example.app`（字母开头，至少一个 `.` 分段，段内小写字母/数字/连字符） | `deb-control` / `packaging-name` |
| 2 | 包含 `/opt/apps/<包名>/files/` 与 `/opt/apps/<包名>/entries/` 两处目录内容 | `deb-layout` |
| 3 | `/opt/apps/<包名>/info` 是普通文件，且为合法 JSON 对象 | `deb-uos-info` |
| 4 | `info.appid` 与 `info.version` 同 control 的 Package / Version 完全一致 | `deb-uos-info` |
| 5 | `info.arch` 是字符串数组，且包含 control 声明的架构 | `deb-uos-info` |
| 6 | `info.permissions` 是对象；已知权限字段（`autostart`、`notification`、`trayicon`、`clipboard`、`account`、`bluetooth`、`camera`、`audio_record`、`installed_apps`）必须为布尔值 | `deb-uos-info` |
| 7 | 包内至少一个 desktop 文件，必填 Name、Exec、Icon、Type、Terminal、StartupNotify | `deb-desktop` |
| 8 | 所有归档条目属主为 root:root（uid=0、gid=0） | `deb-permissions` |
| 9 | 条目不得带 SUID 位；非符号链接条目不得允许组或其他用户写入（SGID 为 warning） | `deb-permissions` |
| 10 | 受限系统目录内不得出现文件类条目：`usr/share/dbus-1/{system.d,services,system-services}/`、`etc/systemd/system/`、`usr/share/ca-certificates/deepin/`、`etc/ssl/certs/`、`usr/local/share/ca-certificates/`、`var/lib/deepin/developer-mode/`、`sys/kernel/security/` | `deb-permissions` |
| 11 | desktop Exec 的绝对路径位于 `/opt/apps/<包名>/` 内时，必须在包内存在且为可执行普通文件 | `deb-desktop` |

warning 级政策（doctor 只提示，需向渠道确认，不阻断退出码）：

| 政策 | 规则 |
| --- | --- |
| preinst / postinst / prerm / postrm 四类维护脚本：UOS 审核规范禁止与打包规范许可存在政策冲突 | `deb-scripts` / `packaging-scripts` |
| 工程声明 `electron-updater` 依赖或 publish 配置：商店交付应使用商店分发机制 | `packaging-updater` |
| Exec 或启动配置显式 `--no-sandbox` / `--disable-setuid-sandbox` | `deb-desktop` / `packaging-sandbox` |
| `etc/`、`var/lib/`、`var/cache/`、`usr/` 内的非白名单条目（白名单：`etc/systemd/user/`、`usr/share/applications/`、`usr/share/icons/`、`etc/<包名>/`、`var/lib/<包名>/`、`var/cache/<包名>/`、`usr/<包名>/`） | `deb-permissions` |
| DEB 文件名与 `包名_版本_架构.deb` 标准命名不一致 | `deb-control` |
| 四段版本号（如 1.2.3.4）：UOS 文档正文与示例冲突，仅提示向渠道确认，不判错 | `deb-uos-info` |
| desktop 不在 `/opt/apps/<包名>/entries/applications/` 标准入口目录 | `deb-desktop` |

## 银河麒麟 V10 规范

适用条件：`--target kylin-v10` 且显式任一 `--channel`，架构 amd64。仅指定 target 不指定渠道时只保留通用检查，厂商布局标记为不适用。

error 级硬限制：

| # | 硬限制 | 规则 |
| --- | --- | --- |
| 1 | 包名以小写字母开头（Debian 语法内更严格的形式） | `deb-control` / `packaging-name` |
| 2 | 包含 `/opt/apps/<包名>/`、`usr/share/applications/`、`usr/share/icons/hicolor/` 三处目录内容 | `deb-layout` |
| 3 | 包内至少一个 desktop 文件，必填 Name、**Name[zh_CN]**、Exec、Icon、Type | `deb-desktop` |

warning 级提示：

| 政策 | 规则 |
| --- | --- |
| `usr/share/applications/` 下的 desktop 文件名应为 `<包名>.desktop` | `deb-desktop` |
| 绝对路径图标应为 PNG/SVG | `deb-icon` |
| 包内嵌套 `.deb` / `.rpm` 文件，疑似二次打包 | `deb-layout` |
| SUID/SGID、组或其他用户可写（通用权限事实） | `deb-permissions` |
| DEB 文件名与标准命名不一致 | `deb-control` |

麒麟文档中 MIPS 架构的 chrome-sandbox 4755 示例不套用 amd64，doctor 不据此判错。

## 通用容器与 Debian 检查

`inspect` 对任何输入总是执行，与 target 无关：

- **`deb-container`**（error）：ar 魔数与成员顺序/唯一性、`debian-binary` 为 2.0、control.tar / data.tar 唯一、tar 校验和与结束块、危险路径（绝对路径、`..`、反斜杠）、链接循环与越界。解析失败或不支持的特性使检查标记 incomplete、退出码 2。额外的 ar 成员（如签名）不会被当作已验签。
- **`deb-control`**（error / warning）：必填字段 Package、Version、Architecture、Maintainer、Description；重复字段；Debian 包名/版本语法（含 epoch）；Priority / Section 已知值。
- **`deb-desktop`**（error / warning / info）：UTF-8 解码、`[Desktop Entry]` 与重复组/字段、布尔字段必须 true/false、Exec 第一项解析（支持双引号绝对路径与 `%U` 等占位符；PATH、env、包装器、转义与动态表达式无法证明最终目标，标为 unknown）。
- **`deb-icon`**（error / warning / info）：绝对路径或图标主题名；主题名在包内 `usr/share/icons/`、`usr/share/pixmaps/`、`opt/apps/<包名>/entries/icons/` 找 PNG/SVG/XPM 候选；相对路径不合法。
- **`deb-permissions`**：tar UID/GID/mode 事实；非 UOS 商店渠道下 SUID/SGID 与组/其他可写为 warning。
- **`deb-scripts`**（info）：枚举 control.tar 中实际存在的四类维护脚本；不执行、不做 ShellCheck。
- **`deb-runtime`**（info / device）：签名信任、sandbox、安装/运行/升级效果始终需要目标真机验证；静态检查不构成厂商审核或兼容结论。

## 默认工程检查（9 条）

无参数时执行，与 target 无关：

| 规则 | 检查内容 | 严重程度 |
| --- | --- | --- |
| [`package-json`](./rules/package-json.md) | 目录是可解析的 Node.js 工程 | error |
| [`electron-dependency`](./rules/electron-dependency.md) | `electron` 在 devDependencies 且版本明确 | error / warning |
| [`lockfile`](./rules/lockfile.md) | 锁文件存在、唯一，并与 `packageManager` 一致 | error / warning |
| [`linux-deb-target`](./rules/linux-deb-target.md) | electron-builder linux target 含 deb，或 Forge 配置 maker-deb | error / warning / info |
| [`deb-metadata`](./rules/deb-metadata.md) | DEB 必填元数据：homepage、maintainer、图标、桌面分类、可执行文件名 | error / warning / info |
| [`product-name-ascii`](./rules/product-name-ascii.md) | DEB 包名符合 dpkg 规则；可执行文件名与安装目录不含非 ASCII | error / warning |
| [`electron-lifecycle`](./rules/electron-lifecycle.md) | Electron 大版本在官方支持窗口内（内置发布表带 `dataAsOf`，超 90 天提示） | warning / info |
| [`electron-platform-architecture`](./rules/electron-platform-architecture.md) | 声明的 Linux 架构有 Electron 官方产物；armv7l/ia32 停发，loong64 等需定制运行时 | error / warning / info |
| [`native-module-abi`](./rules/native-module-abi.md) | 只读解析 `.node` 产物的架构、`NODE_MODULE_VERSION`、`GLIBC_*`/`GLIBCXX_*` 需求与 musl 链接 | warning / info |

## 目标规范工程检查（`--target`）

只读静态检查工程配置，不执行 JS/TS 配置、继承与钩子；无法确定时标为 unknown，不猜测：

| 规则 | 适用 | 级别 | 检查内容 |
| --- | --- | --- | --- |
| `packaging-config` | 显式 target | info | 能否静态读取打包配置；JS/TS 配置、extends、钩子、目录覆盖使最终产物不可推导时说明覆盖不足 |
| `packaging-name` | 显式 target | error / info | 推导最终 DEB 包名并按目标规范校验（UOS 倒置域名 / 麒麟字母开头 / Debian 语法）；scope 名用 productName，Forge 仅认显式 `options.name` |
| `packaging-scripts` | 显式 target | warning / info | electron-builder afterInstall/afterRemove、fpm 四类维护脚本参数、Forge `options.scripts` 的入口与工程内文件存在性；UOS 商店提示政策冲突 |
| `packaging-desktop` | 显式 target | warning / info | 显式 desktop 字段类型、布尔字符串、Icon 路径形式、Forge desktopTemplate 路径；打包器生成的缺省字段不据工程判错 |
| `packaging-updater` | 仅 UOS/store | warning | `electron-updater` 依赖或 publish 配置线索；不证明实际启用自更新 |
| `packaging-sandbox` | 显式 target | warning | 显式启动配置中的 `--no-sandbox` / `--disable-setuid-sandbox`；不扫描业务源码 |

## inspect 支持范围与资源上限

| 格式 | 支持 |
| --- | --- |
| ar + 普通/USTAR tar | 内置；普通文件、目录、符号/硬链接，`./` 根归一 |
| gzip（`.tar.gz`） | 内置（Node zlib） |
| xz（`.tar.xz`） | PATH 中本机 `xz`，固定参数，解压内存限 256 MiB |
| zstd（`.tar.zst`） | PATH 中本机 `zstd`，窗口内存限 256 MB |
| bzip2 / lzma / 其他压缩；PAX、GNU longname、base-256、稀疏文件、设备/FIFO | 不支持，结构化 incomplete，退出码 2 |

默认硬上限（程序 API 可调低，不能调高）：输入 512 MiB；control+data 总展开 1 GiB；单条目 256 MiB；tar 条目 100,000；ar 成员 32；每次读取/解压流 30 秒。解压工具缺失、异常或超时都返回 incomplete，不自动安装。

## 结果语义

- **严重程度**：error 会构建/安装失败或违反厂商硬限制；warning 很可能在目标系统出问题；info 是提示或覆盖不足说明。
- **验证方式**：local 本地可修；device 只能读出事实，必须在统信 UOS / 银河麒麟真机确认。
- **coverage**：每条规则独立报告 `complete` / `not-applicable` / `unknown` / `incomplete`。`complete` 只表示静态阶段完成，不代表规则无错误、兼容或审核通过；被跳过或未验证的规则不会显示为通过。
- **退出码**：0 = 静态检查完成且无 error；1 = 完成但存在 error；2 = 用法错误、读取/解析失败、解压工具缺失或资源超限。inspect 未完成时仍输出结构化报告。
