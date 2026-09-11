# `lockfile`

## 检查什么

工程根目录是否存在包管理器锁文件，是否只有一种，以及是否与 `package.json` 的 `packageManager` 字段一致。

识别的锁文件：`package-lock.json`、`npm-shrinkwrap.json`、`pnpm-lock.yaml`、`yarn.lock`、`bun.lock`、`bun.lockb`。

## 为什么在统信 UOS / 银河麒麟上会出问题

构建机安装到的依赖版本必须与本地一致，否则原生模块和 Electron 版本都可能漂移，真机验证的结论也就失去意义。多个锁文件或 `packageManager` 与锁文件不一致时，构建机无法确定应该用哪个工具安装。

## 结果

| 情况 | 严重程度 | 验证方式 |
| --- | --- | --- |
| 没有锁文件 | error | local |
| 存在多个包管理器的锁文件 | warning | local |
| `packageManager` 声明的工具与锁文件不一致 | warning | local |

## 怎么改

在本地运行一次安装并提交锁文件；只保留实际使用的包管理器的锁文件；统一 `packageManager` 字段。

## 依据来源

- npm、pnpm、yarn 官方文档均要求提交锁文件以获得可复现安装。
- [Node.js `packageManager` 字段说明](https://nodejs.org/api/packages.html#packagemanager)

## 已知局限

不校验锁文件内容与 `package.json` 是否同步。
