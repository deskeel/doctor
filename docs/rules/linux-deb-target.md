# `linux-deb-target`

## 检查什么

electron-builder 的 `linux.target` 是否包含 `deb`，或 Electron Forge 的 `makers` 是否包含 `@electron-forge/maker-deb`。

配置来源按以下顺序识别：`package.json` 的 `build` 字段；`electron-builder.yml` / `.yaml` / `.json`；JS/TS 形式的 electron-builder 配置（只能识别存在，不能读取内容）；`package.json` 的 `config.forge`；`forge.config.*`。

## 为什么在统信 UOS / 银河麒麟上会出问题

两个系统通过 dpkg / apt 安装和卸载应用。electron-builder 未配置 `linux.target` 时默认只产出 AppImage，AppImage 无法进入系统包管理与桌面集成。

## 结果

| 情况 | 严重程度 | 验证方式 |
| --- | --- | --- |
| 未检测到任何打包器配置 | warning | local |
| 配置是 JS/TS 文件或解析失败，无法静态读取 | info | local |
| electron-builder 未配置 `linux.target`，或不含 `deb` | error | local |
| Forge 的 `makers` 中没有 maker-deb | error | local |

## 怎么改

electron-builder：

```json
{ "linux": { "target": ["deb"] } }
```

Electron Forge：安装 `@electron-forge/maker-deb` 并加入 `makers`。

## 依据来源

- [electron-builder Linux 配置](https://www.electron.build/linux)：未配置 target 时默认 AppImage。
- [Electron Forge maker-deb](https://www.electronforge.io/config/makers/deb)

## 已知局限

不执行 JS/TS 配置文件，因此无法检查动态生成的配置；不检查 DEB 元数据（maintainer、图标、分类），由 `deb-metadata` 规则负责。
