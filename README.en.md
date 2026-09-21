# Deskeel Doctor

[![npm](https://img.shields.io/npm/v/%40deskeel-org%2Fdoctor)](https://www.npmjs.com/package/@deskeel-org/doctor)
[![CI](https://github.com/deskeel/doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/deskeel/doctor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[中文](./README.md) | English

Checks whether an Electron project can be shipped to UnionTech UOS and Kylin OS. Open source, zero configuration, runs offline, never uploads your code.

Report text is currently Chinese only. The JSON report (`--json`) uses stable English field names and is the recommended way to consume results from other tools.

## Quick start

Requires Node.js 20.10 or newer. Install dependencies first — `native-module-abi` reads `.node` artifacts from `node_modules`.

```bash
npx @deskeel-org/doctor                                                         # check the current project (9 default rules)
npx @deskeel-org/doctor ./my-app --target uos-v20 --channel store              # add UOS store policy checks
npx @deskeel-org/doctor ./my-app --target kylin-v10 --channel direct           # add Kylin generic packaging checks
npx @deskeel-org/doctor inspect ./com.example.app_1.2.3_amd64.deb \
  --target uos-v20 --channel store                                          # read-only DEB inspection
npx @deskeel-org/doctor --json                                                 # JSON report for CI
```

`--target` accepts `uos-v20` or `kylin-v10`; `--channel` accepts `store`, `direct`, or `enterprise` and requires a target. Both are optional — no channel is guessed. Vendor verdicts cover amd64 artifacts only.

## What it checks

doctor reads only the project's own `package.json`, lockfile, electron-builder / Electron Forge configuration, and `.node` artifacts already present in `node_modules`; `inspect` parses the DEB in memory. It never builds, installs, modifies files, or makes network requests.

Checks come in three layers — see **[the checks reference](./docs/checks.md)** (Chinese) for every rule ID, the UOS / Kylin vendor hard limits, and the evidence behind each rule:

- **Default project checks (9 rules)**: DEB target and metadata, package-name charset, lockfile, Electron support window and architectures, native module ABI.
- **Target packaging checks (`--target`, 6 rules)**: final package-name derivation, maintainer-script entries, desktop fields, UOS store updater policy, sandbox flags.
- **DEB artifact checks (`inspect`, 10 rules)**: container structure, control fields, UOS / Kylin directory layout, the UOS info manifest, desktop/icon references, UID/GID/mode permissions, maintainer scripts. UOS store limits such as root:root ownership, SUID bits, group/world-writable entries, and restricted system directories are error-level hard limits.

`inspect` never installs, executes scripts, extracts to disk, or verifies signatures. tar/gzip are built in; xz/zstd use trusted local tools from PATH — if a tool is missing or fails, the run reports incomplete (exit code 2) instead of installing anything.

## Reading the report

- **Severity**: `error` means the build/install will fail or a vendor hard limit is violated; `warning` means it will likely misbehave on the target system; `info` is a note or insufficient coverage.
- **Verification**: `local` is fixable locally; `device` means doctor can only state facts — actual behavior must be confirmed on a UOS / Kylin machine.
- **Evidence**: the concrete facts behind each conclusion, such as binary paths, symbol versions, and the as-of date of built-in data.

| Exit code | Meaning |
| --- | --- |
| 0 | Static checks completed with no errors (warnings/unknowns may remain) |
| 1 | Completed with error-level findings |
| 2 | Usage error, read/parse failure, missing decompression tool, or resource limit (incomplete) |

### Sample report

```text
Deskeel Doctor v0.1.0
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

## Using in CI

`--json` emits a stable machine-readable report; the exit code works directly as a gate:

```yaml
# GitHub Actions
- run: pnpm install --frozen-lockfile
- run: npx @deskeel-org/doctor --json > doctor-report.json
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: doctor-report
    path: doctor-report.json
```

JSON reports carry a `schemaVersion` field. Adding optional fields does not bump it; removing or renaming fields does, released as a breaking change.

## Using as a library

```ts
import { inspectDeb, runDoctor } from '@deskeel-org/doctor';

const report = await runDoctor({ cwd: './my-app', target: 'uos-v20', channel: 'store' });
const deb = await inspectDeb('./com.example.app_1.2.3_amd64.deb', {
  target: 'uos-v20',
  channel: 'store',
  limits: { inputBytes: 128 * 1024 * 1024 }, // can only lower the defaults
});
process.exitCode = deb.exitCode;
```

`runDoctor` also accepts `rules` (custom rule set) and `now` (fixed clock for reproducible date-based conclusions). The read-only ELF reader (`parseElf`), native-module scanner (`scanNativeModules`), Electron release table (`ELECTRON_RELEASES`), and text renderers (`renderText` / `renderInspectText`) are exported as well.

## Current scope

- Targets: x86_64 DEB delivery on UnionTech UOS V20 and Kylin Desktop V10.
- ARM64 (Phytium, Kunpeng) targets are recognized but not judged; LoongArch, MIPS64, SW64, and RISC-V are registered as requiring custom runtimes.
- Windows and macOS are not checked. No auto-fix, no builds, no packager invocations.
- Runtime behavior, signature trust, sandbox, and upgrades are always marked as requiring on-device verification — static checks are not a vendor-review verdict.

## Contributing

Rules come from real-world delivery failures. Feel free to submit failures you hit on UOS / Kylin, or add on-device evidence to existing rules. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development setup and rule-writing requirements, and [SECURITY.md](./SECURITY.md) for security issues.

## License

[MIT](./LICENSE)
