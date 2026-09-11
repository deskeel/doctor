# `electron-platform-architecture`

## 检查什么

electron-builder `linux.target` 中每个条目声明的 `arch`，归一为规范架构名后对照 Electron 官方 Linux 产物表。

| 规范名 | 归一自 | Electron 官方 Linux 产物 |
| --- | --- | --- |
| `x86_64` | x64、amd64、x86_64 | 有 |
| `aarch64` | arm64、aarch64 | 有 |
| `armv7l` | armv7l、armhf、arm | Electron 43 及以前 |
| `ia32` | ia32、x86、i386、i686 | Electron 18 及以前 |
| `loongarch64`、`mips64el`、`sw_64`、`riscv64`、`ppc64le`、`s390x` | loong64、sw64 等 | 无 |

未声明 `arch` 时不输出结果：electron-builder 的默认架构由命令行参数和构建机决定，doctor 无法从配置得知。Electron Forge 的架构由 `make --arch` 决定，配置中没有可靠的声明位置，同样不判断。

## 为什么在统信 UOS / 银河麒麟上会出问题

- 没有官方产物的架构（龙芯、申威、MIPS、RISC-V 等）需要定制构建的 Electron，doctor 不对定制运行时做判断，报告只登记该目标。
- armv7l 与 ia32 的官方产物已经停发；UOS 与麒麟的桌面版都是 64 位系统。
- arm64 有官方产物，但飞腾、鲲鹏平台的 UOS / 麒麟尚无真机证据，doctor 只识别不判定。

## 结果

| 情况 | 严重程度 | 验证方式 |
| --- | --- | --- |
| 架构没有 Electron 官方产物 | error | local |
| 架构的官方产物已停发，且工程的 Electron 版本在停发之后（或无法确定） | warning | local |
| 架构的官方产物即将停发，工程的 Electron 版本仍有产物 | info | local |
| 声明了 arm64 | info | local |
| 无法识别的架构名 | info | local |

## 怎么改

只保留 `x64`（以及确有需求的 `arm64`）：

```json
{ "linux": { "target": [{ "target": "deb", "arch": ["x64"] }] } }
```

## 依据来源

- [Electron 支持平台](https://www.electronjs.org/docs/latest/tutorial/support#supported-platforms)
- [Electron Breaking Changes](https://www.electronjs.org/docs/latest/breaking-changes)：44.0 起不再发布 `linux-armv7l`；19.0 起不再发布 Linux ia32。

## 已知局限

不读取命令行参数与环境变量；不判断 Forge 工程的架构；不对 arm64 做任何阈值判断；对定制运行时只登记不评估。
