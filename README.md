# DeskKeel Doctor

[![npm](https://img.shields.io/npm/v/%40deskkeel%2Fdoctor)](https://www.npmjs.com/package/@deskkeel/doctor)
[![CI](https://github.com/deskkeel/doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/deskkeel/doctor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

中文 | [English](./README.en.md)

检查一个 Electron 工程能否交付到统信 UOS、银河麒麟。开源、零配置、离线运行，不上传源码。

```bash
npx @deskkeel/doctor
```

## 它回答什么问题

把 Electron 应用交付到国产桌面系统时，多数失败发生在真机上：DEB 装不上、启动即崩、原生模块加载失败。这些问题大部分在源码阶段就有迹象。doctor 只读取工程本身的文件，把能在本地确认的问题直接指出来，把只能在真机上确认的风险单独标出来，不把猜测写成结论。

## 使用

需要 Node.js 20.10 或更高版本。

```bash
npx @deskkeel/doctor              # 检查当前目录
npx @deskkeel/doctor ./my-app     # 检查指定目录
npx @deskkeel/doctor --json       # 输出 JSON 报告，适合 CI
npx @deskkeel/doctor --no-color   # 关闭颜色；也可设置 NO_COLOR 环境变量
```

先安装依赖再运行。`native-module-abi` 规则要从已安装的 `node_modules` 里读取 `.node` 产物，没有 `node_modules` 时它只会提示扫描覆盖不足。

退出码：

| 退出码 | 含义 |
| --- | --- |
| 0 | 没有错误级别的问题 |
| 1 | 存在错误级别的问题 |
| 2 | 用法错误、检查未完成或 doctor 自身运行失败 |

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

## 检查什么

doctor 只读取工程自身的 `package.json`、锁文件、electron-builder / Electron Forge 配置，以及 `node_modules` 里已经存在的 `.node` 产物。它不执行构建和安装，不修改任何文件，不发送任何网络请求。

默认规则共 9 条，按检查对象分三组。每条规则的完整说明、判断依据来源和已知局限见 [docs/rules](./docs/rules/README.md)。

**工程与打包配置**

| 规则 | 检查内容 |
| --- | --- |
| [`package-json`](./docs/rules/package-json.md) | 目录是一个可解析的 Node.js 工程 |
| [`electron-dependency`](./docs/rules/electron-dependency.md) | `electron` 声明在 devDependencies，且版本明确 |
| [`lockfile`](./docs/rules/lockfile.md) | 锁文件存在且唯一，并与 `packageManager` 字段一致 |
| [`linux-deb-target`](./docs/rules/linux-deb-target.md) | electron-builder 的 linux target 含 deb，或 Forge 配置了 maker-deb |
| [`deb-metadata`](./docs/rules/deb-metadata.md) | DEB 必填元数据：homepage、maintainer、图标、桌面分类、可执行文件名 |
| [`product-name-ascii`](./docs/rules/product-name-ascii.md) | DEB 包名符合 dpkg 规则；可执行文件名与安装目录不含非 ASCII 字符 |

**Electron 发行版**

| 规则 | 检查内容 |
| --- | --- |
| [`electron-lifecycle`](./docs/rules/electron-lifecycle.md) | Electron 大版本仍在官方支持窗口内。内置发布表带 `dataAsOf`，超过 90 天会提示可能过期 |
| [`electron-platform-architecture`](./docs/rules/electron-platform-architecture.md) | 声明的 Linux 目标架构有 Electron 官方产物。armv7l、ia32 已停发；loong64、mips64el、sw_64、riscv64 登记为需要定制运行时 |

**原生模块**

| 规则 | 检查内容 |
| --- | --- |
| [`native-module-abi`](./docs/rules/native-module-abi.md) | 识别原生模块，只读解析 `.node` 产物的架构、`NODE_MODULE_VERSION`、`GLIBC_*` / `GLIBCXX_*` 需求与 musl 链接 |

每条规则都写明判断依据的来源。没有官方文档或真机证据来源的规则不会进入默认规则集。

## 怎么读结果

每个结果带两个维度和一份证据：

- **严重程度**：`error` 会导致构建失败或安装失败；`warning` 很可能在目标系统上出问题；`info` 是提示或覆盖不足的说明。
- **验证方式**：`local` 表示可以在本地修复；`device` 表示 doctor 只能读出事实，能否运行必须在统信 UOS / 银河麒麟真机上确认。
- **依据**：结论所基于的具体事实，例如读到的二进制路径与符号版本、内置数据的截止日期。

九条默认规则中，只有 `native-module-abi` 会产出 `device` 结果；可选 DEB 检查也会提示运行验证。它报出预编译产物对 glibc / libstdc++ 的要求，但统信 UOS V20 与银河麒麟 V10 提供的符号版本尚无官方或真机证据，所以结论是“需真机验证”，不是“不兼容”。

## 当前范围

- 目标系统：统信 UOS V20、银河麒麟桌面 V10 的 x86_64 DEB 交付。
- ARM64（飞腾、鲲鹏）目标只识别，不做判定。
- LoongArch、MIPS64、SW64、RISC-V 没有 Electron 官方产物，只登记为需要定制运行时。
- 不检查 Windows、macOS。
- 不自动修复，不执行构建，不调用打包器。

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
import { renderText, runDoctor } from '@deskkeel/doctor';

const report = await runDoctor({ cwd: './my-app' });
console.log(renderText(report));
process.exitCode = report.exitCode;
```

`runDoctor` 还接受 `rules`（自定义规则集）和 `now`（固定运行时刻，让日期类结论可复现）。只读 ELF 读取器（`parseElf`）、原生模块扫描器（`scanNativeModules`）和 Electron 发布表（`ELECTRON_RELEASES`）也作为库导出。

## 参与

规则来源于真实交付中遇到的问题。欢迎提交你在统信 UOS / 银河麒麟上遇到的失败案例，或为现有规则补充真机证据。开发环境、代码规范和规则编写要求见 [CONTRIBUTING.md](./CONTRIBUTING.md)，安全问题见 [SECURITY.md](./SECURITY.md)。

## 许可证

[MIT](./LICENSE)

## 可选发行版规范与只读 DEB 检查

```bash
npx @deskkeel/doctor ./my-app --target uos-v20 --channel store --json
npx @deskkeel/doctor ./my-app --target kylin-v10 --channel direct
npx @deskkeel/doctor inspect ./com.example.app_1.2.3_amd64.deb --target uos-v20 --channel store --json
```

`target` 支持 `uos-v20`、`kylin-v10`；`channel` 支持 `store`、`direct`、`enterprise` 且必须同时指定 target。均可省略，不猜测商店。UOS 商店政策仅对 UOS/store 生效；麒麟通用打包规范在显式渠道下启用，不推定额外渠道政策。厂商产物判定仅覆盖 amd64。

工程只读静态包名、维护脚本入口、显式 desktop/updater/sandbox 配置；动态 JS/TS、继承与钩子不执行，无法确定时标为 unknown。inspect 在内存/流中检查 ar/tar、control、目录、UOS info、desktop/图标引用、UID/GID/mode 与四类维护脚本清单；不安装、不解包到用户目录、不运行包内代码、不上传、不联网、不验签，也不读取 deskkeel.yml。

未压缩与 gzip 内置支持；xz/zstd 使用本机 PATH 中的可信 `xz`/`zstd`，工具缺失或失败即 incomplete/退出 2，不自动安装。PAX/GNU longname、base-256、稀疏/特殊设备和其他压缩目前也以未完成结束。默认上限为输入 512 MiB、总展开 1 GiB、单条目 256 MiB、100,000 条 tar 记录、32 个 ar 成员与每个读取/解压流 30 秒；解压过程中检查体积及条目预算。详情见[支持矩阵与规则依据](./docs/rules/packaging.md)。

原工程 JSON schema=1 和九条默认规则保持兼容，显式目标增加可选 `packaging`。inspect 使用独立 schema=1、`inputType: "deb"`，报告 target/channel、规则集版本、覆盖、findings 与 completion。`complete` 表示静态阶段完成，不代表审核/兼容通过。coverage 的 `unknown`、`not-applicable`、`incomplete` 不会被当作通过；运行、sandbox、签名信任与 ABI 始终需目标验证。

退出码：0=静态检查完成且无 error（允许 warning/unknown）；1=已完成但有规则 error；2=用法错误、读取/解析/压缩工具/资源限制失败。inspect 未完成仍输出 JSON 报告。UOS 脚本政策冲突与四段版本/三段示例冲突用 warning；不把麒麟 MIPS 4755 示例套用 amd64。

```ts
import { inspectDeb, renderInspectText, runDoctor } from '@deskkeel/doctor';

const project = await runDoctor({ cwd: './my-app', target: 'uos-v20', channel: 'store' });
const report = await inspectDeb('./com.example.app_1.2.3_amd64.deb', {
  target: 'uos-v20', channel: 'store',
  limits: { inputBytes: 128 * 1024 * 1024 }, // 只能降低默认资源上限
});
console.log(renderInspectText(report));
process.exitCode = report.exitCode;
```

Node 运行要求仍为 20.10+；源码测试需要支持 TypeScript 类型剥离的 Node 22。真实客户工程/包、目标机安装、厂商审核、签名信任及升级效果仍待验证，合成测试不代表真机通过。
