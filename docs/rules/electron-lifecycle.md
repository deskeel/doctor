# `electron-lifecycle`

## 检查什么

工程使用的 Electron 大版本是否仍在官方支持窗口内。版本按以下顺序确定：`node_modules/electron/package.json` 里实际安装的版本；否则 `package.json` 中声明的版本范围的第一个大版本号。`latest`、`*` 等无法确定大版本的写法不判断，由 `electron-dependency` 提示。

判断依据是随 doctor 一起发布的 Electron 发布表（`src/data/electron-releases.ts`），带 `dataAsOf` 字段。运行时刻距 `dataAsOf` 超过 90 天时，结果里附一条“发布窗口信息可能过期”的提示。

## 为什么在统信 UOS / 银河麒麟上会出问题

Electron 只维护最新的三个大版本。停止维护后不再有安全修复和 Chromium 更新，交付到国产系统后发现的运行时问题也不会有上游修复。

## 结果

| 情况 | 严重程度 | 验证方式 |
| --- | --- | --- |
| 大版本在发布表中且已过 EOL 日期 | warning | local |
| 大版本早于发布表覆盖范围（一定已停止维护） | warning | local |
| 大版本晚于发布表覆盖范围，无法判断 | info | local |
| 发布表数据超过 90 天未更新 | info | local |

每条结果的 `evidence` 里带发布表的截止日期。

## 怎么改

升级到仍在维护的 Electron 大版本，并提交锁文件。发布表过期时升级 `@deskeel-org/doctor`，或到 [endoflife.date/electron](https://endoflife.date/electron) 核对。

## 依据来源

- [Electron 发布时间线与支持策略](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)：同时维护最新的三个大版本。
- [endoflife.date/electron](https://endoflife.date/electron) 与 [releases.electronjs.org](https://releases.electronjs.org/)：各大版本的发布与 EOL 日期，于 2026-09-10 核对。

## 已知局限

不解析锁文件；不核对补丁版本是否为该系列最新；发布表需要随 doctor 发布手动更新。
