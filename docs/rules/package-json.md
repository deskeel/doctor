# `package-json`

## 检查什么

目标目录是否存在可解析的 `package.json`，且顶层是对象。

## 为什么在统信 UOS / 银河麒麟上会出问题

没有 `package.json` 就无法确定 Electron 版本、依赖和打包配置，后续所有规则都无法执行。

## 结果

| 情况 | 严重程度 | 验证方式 |
| --- | --- | --- |
| 文件不存在 | error | local |
| 文件无法解析或顶层不是对象 | error | local |

其他规则在本规则失败时不再输出结果。

## 怎么改

在 Electron 工程根目录运行 doctor，或用位置参数指定工程目录。

## 依据来源

[npm package.json 规范](https://docs.npmjs.com/cli/configuring-npm/package-json)

## 已知局限

不支持 monorepo 中的多个 Electron 工程，需要分别指定目录。
