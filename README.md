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

doctor 只读取工程自身的 `package.json`、锁文件和 electron-builder / Electron Forge 配置。它不执行构建，不修改文件，不发送任何网络请求。

每条规则说明三件事：检查什么、为什么在 UOS / 银河麒麟上会出问题、怎么改。每个结果带两个维度：

- 严重程度：`error`、`warning`、`info`。
- 验证方式：`local` 表示可以在本地修复；`device` 表示必须在真机上验证。

当前默认规则见 [docs/rules](./docs/rules/README.md)：

| 规则 | 检查内容 |
| --- | --- |
| `package-json` | 目录是一个可解析的 Node.js 工程 |
| `electron-dependency` | `electron` 声明在 devDependencies，且版本明确 |
| `lockfile` | 锁文件存在且唯一，并与 `packageManager` 字段一致 |
| `linux-deb-target` | electron-builder 的 linux target 含 deb，或 Forge 配置了 maker-deb |

每条规则都写明判断依据的来源。没有真机验证或官方文档来源的规则不会进入默认规则集。

## 作为库使用

```ts
import { renderText, runDoctor } from '@deskkeel/doctor';

const report = await runDoctor({ cwd: './my-app' });
console.log(renderText(report));
process.exitCode = report.exitCode;
```

JSON 报告带 `schemaVersion` 字段，字段变化遵循语义化版本。

## 参与

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。安全问题见 [SECURITY.md](./SECURITY.md)。

## 许可证

[MIT](./LICENSE)
