# `native-module-abi`

## 检查什么

只读扫描 `node_modules`，找出原生模块并解析它们已经存在的 `.node` 产物。

**识别原生模块**的依据（任一命中）：包目录含 `binding.gyp`；`package.json` 有 `gypfile: true` 或 node-pre-gyp 的 `binary` 字段；包目录含 `prebuilds/`；依赖 `node-gyp-build`、`prebuild-install`、`@mapbox/node-pre-gyp`、`node-pre-gyp`、`cmake-js`、`node-addon-api`、`nan`；`install` 脚本调用上述工具或 `node-gyp`。

**扫描范围**：`node_modules/<包>`、`node_modules/@scope/<包>`，以及 pnpm 虚拟仓库 `node_modules/.pnpm/*/node_modules/<包>`。产物位置：`prebuilds/**`（两层）、`build/Release/`、`lib/binding/**`（三层）。

**从每个 ELF 产物读出**：架构；是否 musl（`DT_NEEDED` 链接 `libc.musl-*`，或文件名含 `.musl.`）；`.gnu.version_r` 里最高的 `GLIBC_*`、`GLIBCXX_*`、`CXXABI_*`、`GCC_*`；从文件名或路径推断的 `NODE_MODULE_VERSION`（`abi116`、`napi`、`node-v115`）。Mach-O、PE 等非 ELF 文件只登记路径。

## 为什么在统信 UOS / 银河麒麟上会出问题

Electron 官方 x86_64 产物对 glibc 的要求很低，真实的加载失败几乎都来自原生模块的预编译产物：它们在较新的 glibc / libstdc++ 上编译，运行时要求目标系统提供对应版本的符号（例如 `GLIBC_2.34`）。UOS V20 与麒麟 V10 的 glibc、libstdc++ 版本目前没有官方或真机证据，doctor 只能报出产物的要求，结论必须在真机上验证。

## 结果

| 情况 | 严重程度 | 验证方式 |
| --- | --- | --- |
| `node_modules` 不存在 | info | local |
| 原生模块有 linux-x64 的 glibc 产物，读出了 `GLIBC_*` / `GLIBCXX_*` 需求 | warning | device |
| 原生模块有 linux-x64 产物，但没有带版本的符号需求 | info | local |
| 原生模块的 linux-x64 产物只有 musl 构建 | warning | local |
| 原生模块没有 linux-x64 产物（只有其他平台，或没有任何产物） | info | local |

每条结果的 `evidence` 列出识别依据和每个产物读出的事实。

## 怎么改

在目标系统真机上安装并启动一次。若加载失败：在目标系统上用 `node-gyp` 从源码重新编译；或选用 glibc 需求更低的预编译版本；或使用 `electron-rebuild` / `@electron/rebuild` 在与目标系统 glibc 一致的构建环境中重建。

在 macOS / Windows 上运行 doctor 时，本机通常只有当前平台的产物，本规则只能报“扫描覆盖不足”。在 Linux x86_64 构建机上安装依赖后再运行可以得到完整结果。

## 依据来源

- [Node-API ABI 稳定性](https://nodejs.org/api/n-api.html#abi-stability) 与 [Node.js 版本表](https://nodejs.org/en/download/releases)：`NODE_MODULE_VERSION` 的含义。
- [Electron 原生模块指南](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [GNU ld 符号版本](https://sourceware.org/binutils/docs/ld/VERSION.html)：`.gnu.version_r` 的语义。
- [prebuildify 产物命名](https://github.com/prebuild/prebuildify#naming)、[node-pre-gyp](https://github.com/mapbox/node-pre-gyp)：产物路径与 ABI 标签。

## 已知局限

不扫描 Electron 本体（`node_modules/electron/dist`）；不解析 `binary.module_path` 的自定义模板，只扫描固定目录；不比对目标系统的符号表（需要 UOS / 麒麟的 Profile 快照，尚未收录）；不判断 `NODE_MODULE_VERSION` 与工程 Electron 版本是否匹配；不执行任何安装或重建。
