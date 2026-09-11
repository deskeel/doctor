# DeskKeel Doctor

[![CI](https://github.com/deskkeel/doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/deskkeel/doctor/actions/workflows/ci.yml)

检查一个 Electron 工程能否交付到统信 UOS、银河麒麟。开源、零配置，离线运行，不上传源码。

> 尚未发布到 npm。首个版本发布前，下面的 `npx` 命令还不可用。

## 使用

```bash
npx @deskkeel/doctor            # 检查当前目录
npx @deskkeel/doctor ./my-app   # 检查指定目录
npx @deskkeel/doctor --json     # 输出机器可读结果，适合 CI
```

退出码：

| 退出码 | 含义 |
| --- | --- |
| 0 | 没有错误级别的问题 |
| 1 | 存在错误级别的问题 |
| 2 | doctor 自身运行失败 |

## 检查什么

doctor 只读取工程自身的 `package.json`、锁文件、electron-builder / Electron Forge 配置，以及已安装的 `node_modules` 里已经存在的 `.node` 产物。它不执行构建和安装，不修改文件，不发送任何网络请求。

每条规则说明三件事：检查什么、为什么在 UOS / 银河麒麟上会出问题、怎么改。每个结果带两个维度和一份证据：

- 严重程度：`error`、`warning`、`info`。
- 验证方式：`local` 表示可以在本地修复；`device` 表示必须在真机上验证。
- `evidence`：结论依据的具体事实，例如读到的二进制路径与符号版本、内置数据的截止日期。

当前默认规则见 [docs/rules](./docs/rules/README.md)：

| 规则 | 检查内容 |
| --- | --- |
| `package-json` | 目录是一个可解析的 Node.js 工程 |
| `electron-dependency` | `electron` 声明在 devDependencies，且版本明确 |
| `electron-lifecycle` | Electron 大版本仍在官方支持窗口内（内置发布表带 `dataAsOf`，超过 90 天提示可能过期） |
| `electron-platform-architecture` | 声明的 Linux 目标架构有 Electron 官方产物；armv7l / ia32 已停发；国产指令集登记为需要定制运行时 |
| `lockfile` | 锁文件存在且唯一，并与 `packageManager` 字段一致 |
| `linux-deb-target` | electron-builder 的 linux target 含 deb，或 Forge 配置了 maker-deb |
| `deb-metadata` | DEB 必填元数据：homepage、maintainer、图标、桌面分类、可执行文件名 |
| `product-name-ascii` | DEB 包名符合 dpkg 规则；可执行文件名与安装目录不含非 ASCII 字符 |
| `native-module-abi` | 识别原生模块，只读解析 `.node` 产物的架构、`NODE_MODULE_VERSION`、`GLIBC_*` / `GLIBCXX_*` 需求与 musl 链接 |

每条规则都写明判断依据的来源。没有真机验证或官方文档来源的规则不会进入默认规则集。

目前只有 `native-module-abi` 会产出 `device` 结果：它报出预编译产物对 glibc / libstdc++ 的要求，但统信 UOS V20 与银河麒麟 V10 提供的符号版本尚无官方或真机证据，所以结论是“需真机验证”，不是“不兼容”。

## 作为库使用

```ts
import { renderText, runDoctor } from '@deskkeel/doctor';

const report = await runDoctor({ cwd: './my-app' });
console.log(renderText(report));
process.exitCode = report.exitCode;
```

`runDoctor` 还接受 `rules`（自定义规则集）和 `now`（固定运行时刻，让日期类结论可复现）。ELF 读取器、原生模块扫描器和 Electron 发布表也作为库导出。

JSON 报告带 `schemaVersion` 字段。新增可选字段（如 `evidence`）不递增它；删除或改名字段才递增，并作为破坏性变更发布。

## 参与

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。安全问题见 [SECURITY.md](./SECURITY.md)。

## 许可证

[MIT](./LICENSE)
