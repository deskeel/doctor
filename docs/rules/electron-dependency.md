# `electron-dependency`

## 检查什么

`package.json` 是否把 `electron` 声明为 devDependencies，以及版本范围是否明确。

## 为什么在统信 UOS / 银河麒麟上会出问题

- 没有声明 `electron` 就无法确定运行时版本，也就无法判断它对目标系统 glibc 和系统库的要求。
- `electron` 放在 dependencies 时，打包器会把它当作应用依赖复制进安装包，导致 DEB 体积异常并可能重复携带 Electron 二进制。
- 版本写成 `latest`、`*` 等不明确的范围时，每次安装可能拿到不同的大版本，对国产系统的兼容结论也会随之变化。

## 结果

| 情况 | 严重程度 | 验证方式 |
| --- | --- | --- |
| 未声明 electron | error | local |
| 声明在 dependencies | warning | local |
| 版本范围为空、`*`、`latest` 或 `x` | warning | local |

## 怎么改

```bash
npm install --save-dev electron@^31.0.0
```

并提交锁文件。

## 依据来源

[Electron 官方安装指南](https://www.electronjs.org/docs/latest/tutorial/installation) 要求把 electron 放在 devDependencies。

## 已知局限

只检查版本范围字符串，不解析锁文件中实际安装的版本；也不判断该版本是否已经停止维护。
