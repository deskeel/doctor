# DeskKeel Doctor

[![npm](https://img.shields.io/npm/v/%40deskkeel%2Fdoctor)](https://www.npmjs.com/package/@deskkeel/doctor)
[![CI](https://github.com/deskkeel/doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/deskkeel/doctor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

中文 | [English](./README.en.md)

检查一个 Electron 工程能否交付到统信 UOS、银河麒麟。开源、零配置、离线运行，不上传源码。

## 快速开始

需要 Node.js 20.10 或更高版本，先安装依赖再运行（`native-module-abi` 要读取已安装的 `.node` 产物）。

```bash
npx @deskkeel/doctor                                                         # 检查当前工程（默认 9 条规则）
npx @deskkeel/doctor ./my-app --target uos-v20 --channel store              # 附加 UOS 商店规范检查
npx @deskkeel/doctor ./my-app --target kylin-v10 --channel direct           # 附加麒麟通用打包规范
npx @deskkeel/doctor inspect ./com.example.app_1.2.3_amd64.deb \
  --target uos-v20 --channel store                                          # 只读检查 DEB 产物
npx @deskkeel/doctor --json                                                 # JSON 报告，适合 CI
```

`--target` 可选 `uos-v20`、`kylin-v10`；`--channel` 可选 `store`、`direct`、`enterprise`，必须与 target 同用；均可省略，不猜测渠道。厂商产物判定仅覆盖 amd64。

## 检查什么

doctor 只读取工程自身的 `package.json`、锁文件、electron-builder / Electron Forge 配置和 `node_modules` 里已存在的 `.node` 产物；`inspect` 只在内存/流中解析 DEB。不执行构建和安装，不修改任何文件，不发送网络请求。

检查分三层，全部规则 ID、UOS / 麒麟厂商硬限制与判断依据见 **[检测项清单](./docs/checks.md)**：

- **默认工程检查（9 条）**：DEB 目标与元数据、包名字符集、锁文件、Electron 支持窗口与架构、原生模块 ABI。
- **目标规范工程检查（`--target`，6 条）**：最终包名推导、维护脚本入口、desktop 字段、UOS 商店 updater 政策、sandbox 参数。
- **DEB 产物检查（`inspect`，10 条）**：容器结构、control、UOS / 麒麟目录布局、UOS info 清单、desktop 与图标、UID/GID/mode 权限、维护脚本清单。UOS 商店的 root:root 所有权、SUID、组/其他可写、受限系统目录等均为 error 级硬限制。

`inspect` 不安装、不执行脚本、不落盘解包、不验签；tar/gzip 内置支持，xz/zstd 使用本机 PATH 中的工具，缺失或失败即返回未完成（退出码 2），不自动安装。

## 怎么读结果

- **严重程度**：`error` 会构建/安装失败或违反厂商硬限制；`warning` 很可能在目标系统上出问题；`info` 是提示或覆盖不足的说明。
- **验证方式**：`local` 本地可修；`device` 表示 doctor 只能读出事实，能否运行必须在统信 UOS / 银河麒麟真机上确认。
- **依据**：结论所基于的具体事实，例如读到的二进制路径与符号版本、内置数据的截止日期。

| 退出码 | 含义 |
| --- | --- |
| 0 | 静态检查完成且无 error（仍可能有 warning / unknown） |
| 1 | 静态检查完成，存在 error |
| 2 | 用法错误、输入读取/解析失败、解压工具缺失或资源超限（未完成） |

### 报告示例

```text
DeskKeel Doctor v0.1.0
目录：/home/me/my-app
工程：my-app 1.4.0
Electron：^44.0.0
包管理器：pnpm
打包器：electron-builder

✖ [deb-metadata] package.json#build 未声明 maintainer，package.json 的 author 也没有邮箱
    原因：electron-builder 生成 DEB 的 Maintainer 字段时会回退到 package.json 的 author 邮箱，两者都没有时构建直接失败。
    建议：在 linux.maintainer 写 "名字 <邮箱>"，或在 package.json 的 author 中填写 email。
⚠ [native-module-abi] better-sqlite3@11.0.0 的 linux-x64 预编译要求 GLIBC_2.34、GLIBCXX_3.4.29 [需真机验证]
    原因：统信 UOS V20 / 银河麒麟 V10 的 glibc 与 libstdc++ 提供的符号版本尚无官方或真机证据，需真机验证该模块能否加载。
    建议：在目标系统真机上安装并启动一次；若加载失败，可在目标系统上用 node-gyp 从源码重新编译，或选用 glibc 需求更低的预编译版本。
    依据：node_modules/better-sqlite3/build/Release/better_sqlite3.node（x86_64，NODE_MODULE_VERSION 132，GLIBC_2.34，GLIBCXX_3.4.29）

结果：1 个错误，1 个警告，0 条提示
其中 1 项需要在真机上验证。
```

## 在 CI 中使用

`--json` 输出稳定的机器可读报告，退出码可直接作为门禁：

```yaml
# GitHub Actions
- run: pnpm install --frozen-lockfile
- run: npx @deskkeel/doctor --json > doctor-report.json
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: doctor-report
    path: doctor-report.json
```

JSON 报告带 `schemaVersion` 字段。新增可选字段不递增它；删除或改名字段才递增，并作为破坏性变更发布。

## 作为库使用

```ts
import { inspectDeb, runDoctor } from '@deskkeel/doctor';

const report = await runDoctor({ cwd: './my-app', target: 'uos-v20', channel: 'store' });
const deb = await inspectDeb('./com.example.app_1.2.3_amd64.deb', {
  target: 'uos-v20',
  channel: 'store',
  limits: { inputBytes: 128 * 1024 * 1024 }, // 只能降低默认资源上限
});
process.exitCode = deb.exitCode;
```

`runDoctor` 还接受 `rules`（自定义规则集）和 `now`（固定运行时刻，让日期类结论可复现）。只读 ELF 读取器（`parseElf`）、原生模块扫描器（`scanNativeModules`）、Electron 发布表（`ELECTRON_RELEASES`）与文本渲染器（`renderText` / `renderInspectText`）也作为库导出。

## 当前范围

- 目标系统：统信 UOS V20、银河麒麟桌面 V10 的 x86_64 DEB 交付。
- ARM64（飞腾、鲲鹏）目标只识别，不做判定；LoongArch、MIPS64、SW64、RISC-V 只登记为需要定制运行时。
- 不检查 Windows、macOS；不自动修复，不执行构建，不调用打包器。
- 运行、签名信任、sandbox、升级等行为检查始终标记为需真机验证，静态检查不构成厂商审核结论。

## 参与

规则来源于真实交付中遇到的问题。欢迎提交你在统信 UOS / 银河麒麟上遇到的失败案例，或为现有规则补充真机证据。开发环境、代码规范和规则编写要求见 [CONTRIBUTING.md](./CONTRIBUTING.md)，安全问题见 [SECURITY.md](./SECURITY.md)。

## 许可证

[MIT](./LICENSE)
