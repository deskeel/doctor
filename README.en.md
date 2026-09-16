# DeskKeel Doctor

[![npm](https://img.shields.io/npm/v/%40deskkeel%2Fdoctor)](https://www.npmjs.com/package/@deskkeel/doctor)
[![CI](https://github.com/deskkeel/doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/deskkeel/doctor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[中文](./README.md) | English

Checks whether an Electron project can be shipped to UnionTech UOS and Kylin OS, the two Linux desktops used across the Chinese public sector. Open source, zero configuration, runs offline, never uploads your code.

```bash
npx @deskkeel/doctor
```

Report text is currently Chinese only. The JSON report (`--json`) uses stable English field names and is the recommended way to consume results from other tools.

## What question it answers

Most failures when shipping Electron apps to these desktops show up on the target machine: the DEB will not install, the app crashes on launch, a native module fails to load. Most of them leave traces in the source tree. doctor reads only the project's own files, reports the problems it can confirm locally, and separately flags the risks that can only be confirmed on a real device. It never turns a guess into a verdict.

## Usage

Requires Node.js 20.10 or later.

```bash
npx @deskkeel/doctor              # check the current directory
npx @deskkeel/doctor ./my-app     # check a specific directory
npx @deskkeel/doctor --json       # machine-readable report, for CI
npx @deskkeel/doctor --no-color   # disable colors; NO_COLOR is also honored
```

Install dependencies before running. The `native-module-abi` rule reads `.node` binaries from the installed `node_modules`; without it the rule can only report insufficient coverage.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | No error-level findings |
| 1 | At least one error-level finding |
| 2 | Usage error, incomplete inspection, or doctor itself failed to run |

## What it checks

doctor reads only the project's `package.json`, lockfile, electron-builder / Electron Forge configuration, and the `.node` binaries already present in `node_modules`. It does not build, install, modify files, or make network requests.

Nine default rules, grouped by subject. Each rule's full description, the source of its thresholds, and its known limitations are documented in [docs/rules](./docs/rules/README.md) (Chinese).

**Project and packaging configuration**

| Rule | Checks |
| --- | --- |
| `package-json` | The directory is a parseable Node.js project |
| `electron-dependency` | `electron` is declared in devDependencies with an explicit version |
| `lockfile` | Exactly one lockfile exists and matches the `packageManager` field |
| `linux-deb-target` | electron-builder's linux target includes deb, or Forge has maker-deb configured |
| `deb-metadata` | Required DEB metadata is present: homepage, maintainer, icon, desktop category, executable name |
| `product-name-ascii` | The DEB package name satisfies dpkg rules; executable name and install path contain no non-ASCII characters |

**Electron release**

| Rule | Checks |
| --- | --- |
| `electron-lifecycle` | The Electron major is inside the official support window. The bundled release table carries a `dataAsOf` date and warns when older than 90 days |
| `electron-platform-architecture` | Declared Linux target architectures have official Electron binaries. armv7l and ia32 are discontinued; loong64, mips64el, sw_64 and riscv64 are recorded as needing a custom runtime |

**Native modules**

| Rule | Checks |
| --- | --- |
| `native-module-abi` | Detects native modules and parses their `.node` binaries read-only: architecture, `NODE_MODULE_VERSION`, required `GLIBC_*` / `GLIBCXX_*` symbol versions, and musl linkage |

Every rule cites the source of its judgement. Rules without an official document or real-device evidence do not enter the default set.

## How to read the results

Each finding carries two dimensions and its evidence:

- **Severity**: `error` will break the build or the install; `warning` is likely to fail on the target system; `info` is a note or a coverage gap.
- **Verification**: `local` means it can be fixed on your machine; `device` means doctor can only read the facts, and whether the app runs must be confirmed on a real UOS / Kylin device.
- **Evidence**: the concrete facts behind the conclusion, such as the binary path and symbol versions that were read, or the cut-off date of bundled data.

Among the nine default rules, only `native-module-abi` produces `device` findings. Optional DEB inspection also flags runtime verification. It reports what glibc / libstdc++ versions a prebuilt binary requires, but there is no official or device-verified evidence yet for the symbol versions UOS V20 and Kylin V10 provide, so the verdict is "needs device verification", not "incompatible".

## Current scope

- Targets: x86_64 DEB delivery to UnionTech UOS V20 and Kylin Desktop V10.
- ARM64 targets (Phytium, Kunpeng) are recognized but not judged.
- LoongArch, MIPS64, SW64 and RISC-V have no official Electron binaries and are only recorded as needing a custom runtime.
- No Windows or macOS checks.
- No auto-fix, no builds, no packager invocation.

## In CI

`--json` prints a stable machine-readable report and the exit code works as a gate:

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

The JSON report carries a `schemaVersion` field. Adding optional fields does not bump it; removing or renaming fields does, and ships as a breaking change.

## As a library

```ts
import { renderText, runDoctor } from '@deskkeel/doctor';

const report = await runDoctor({ cwd: './my-app' });
console.log(renderText(report));
process.exitCode = report.exitCode;
```

`runDoctor` also accepts `rules` (a custom rule set) and `now` (a fixed clock so date-based findings are reproducible). The read-only ELF reader (`parseElf`), the native module scanner (`scanNativeModules`) and the Electron release table (`ELECTRON_RELEASES`) are exported too.

## Contributing

Rules come from real delivery failures. Failure cases you hit on UOS / Kylin, and device evidence for existing rules, are the most valuable contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development setup and rule-writing requirements, and [SECURITY.md](./SECURITY.md) for reporting security issues. Both are in Chinese; issues and pull requests in English are welcome.

## License

[MIT](./LICENSE)

## Optional distribution checks and read-only DEB inspection

```bash
npx @deskkeel/doctor ./my-app --target uos-v20 --channel store --json
npx @deskkeel/doctor ./my-app --target kylin-v10 --channel direct
npx @deskkeel/doctor inspect ./com.example.app_1.2.3_amd64.deb --target uos-v20 --channel store --json
```

Targets: `uos-v20`, `kylin-v10`. Channels: `store`, `direct`, `enterprise`; a channel requires a target. Both are optional; no store channel is assumed. UOS store policy applies only to UOS/store. Kylin's general packaging guidance applies with an explicit channel, without inventing additional channel policy. Vendor artifact checks cover amd64 only.

Project checks read static package-name derivation, script references and explicit desktop/updater/sandbox settings. Dynamic JS/TS, inherited configuration and hooks are never executed; unresolved values remain unknown. `inspect` reads ar/tar, control, layout, UOS info, desktop/icon references, UID/GID/mode and the four maintainer-script names in bounded memory/streams. It never installs, extracts to user directories, executes package code, uploads, accesses the network, verifies signatures or reads deskkeel.yml.

Uncompressed tar and gzip are built in. xz/zstd use trusted local `xz`/`zstd` executables from PATH; missing/failing tools produce incomplete/exit 2 and are never auto-installed. PAX/GNU longname, base-256, sparse/special entries and other compression formats currently also stop as incomplete. Defaults: 512 MiB input, 1 GiB total expanded data, 256 MiB per entry, 100,000 tar entries, 32 ar members, 30 seconds per read/decompression stream. Expanded size and entry budgets are enforced while decompressing. See the [support matrix and direct rule sources](./docs/rules/packaging.md).

The original project JSON schema=1 and nine default rules remain compatible; an explicit target adds optional `packaging`. Inspect has a separate schema=1 with `inputType: "deb"`, context, ruleset version, coverage, findings and completion. `complete` means static processing finished, not vendor approval or compatibility. Unknown, not-applicable and incomplete coverage is never presented as a pass. Runtime behavior, sandbox, signature trust and ABI require target-device verification.

Exit codes: 0=static processing complete without errors (warnings/unknowns allowed); 1=completed with rule errors; 2=usage, read, parse, codec or resource-limit failure. An incomplete inspect still emits JSON. Conflicting UOS script guidance and four-component version text versus three-component examples produce warnings. The Kylin MIPS 4755 example is never treated as an amd64 requirement.

```ts
import { inspectDeb, renderInspectText, runDoctor } from '@deskkeel/doctor';

const project = await runDoctor({ cwd: './my-app', target: 'uos-v20', channel: 'store' });
const report = await inspectDeb('./com.example.app_1.2.3_amd64.deb', {
  target: 'uos-v20', channel: 'store',
  limits: { inputBytes: 128 * 1024 * 1024 }, // May only lower the defaults
});
console.log(renderInspectText(report));
process.exitCode = report.exitCode;
```

Runtime support remains Node 20.10+. Source tests require a Node 22 release with TypeScript type stripping. Real customer projects/packages, target installation, vendor review, trust and upgrades remain separately unverified; synthetic tests do not establish device compatibility.
