# `deb-metadata`

## 检查什么

在打包配置会产出 DEB 的前提下（electron-builder 的 `linux.target` 含 `deb`，或 Forge 配置了 `@electron-forge/maker-deb`），检查四项元数据是否可以确定：

| 项目 | electron-builder 读取位置 | Forge maker-deb 读取位置 |
| --- | --- | --- |
| Maintainer | `deb.maintainer`、`linux.maintainer`，否则 `package.json` 的 `author` 邮箱 | `options.maintainer`，否则 `package.json` 的 `author` 邮箱 |
| 图标 | `linux.icon`、`deb.icon`、顶层 `icon`，否则 `<buildResources>/icon.png` 或 `<buildResources>/icons/` 是否存在（`buildResources` 默认 `build`） | `options.icon` |
| 桌面分类 | `linux.category` | `options.categories` |
| 可执行文件名 | `linux.executableName`、`executableName`、`productName`、`name` 任一 | `options.bin`，默认 `package.json` 的 `name`，总能确定 |

## 为什么在统信 UOS / 银河麒麟上会出问题

- Maintainer 是 Debian control 文件的必填字段。electron-builder 在 `maintainer` 与 `author` 邮箱都缺失时直接构建失败；maker-deb 会生成不完整的 Maintainer，dpkg 与 lintian 会报告问题。
- 没有图标时两种打包器都退回 Electron 默认图标，用户在桌面和启动器里看到的是 Electron 标志。
- `.desktop` 缺少 `Categories` 时，应用在启动器里可能落入“其他”分类或不出现在分类菜单中。maker-deb 有默认分类，electron-builder 没有。

## 结果

| 情况 | 严重程度 | 验证方式 |
| --- | --- | --- |
| electron-builder：`maintainer` 与 `author` 邮箱都缺失 | error | local |
| electron-builder：未声明 `linux.category` | warning | local |
| electron-builder：未声明图标且默认图标文件不存在 | warning | local |
| electron-builder：无法确定可执行文件名 | warning | local |
| Forge：`options.maintainer` 与 `author` 邮箱都缺失 | warning | local |
| Forge：未声明 `options.icon` | warning | local |
| Forge：未声明 `options.categories`（将使用默认 GNOME、GTK、Utility） | info | local |

打包配置不产出 DEB、或配置是 JS/TS 文件无法静态读取时，本规则不输出结果，由 `linux-deb-target` 负责提示。

## 怎么改

electron-builder：

```json
{
  "build": {
    "linux": {
      "target": ["deb"],
      "maintainer": "Your Name <you@example.com>",
      "category": "Utility",
      "icon": "build/icons"
    }
  }
}
```

Electron Forge：

```js
{
  name: '@electron-forge/maker-deb',
  config: { options: { maintainer: 'Your Name <you@example.com>', icon: 'assets/icon.png', categories: ['Utility'] } }
}
```

## 依据来源

- [electron-builder Linux 选项](https://www.electron.build/linux)：`maintainer` 默认取 `author`；`icon` 默认取 `build/icon.png` 或 `build/icons/`。
- [electron-installer-debian 选项](https://github.com/electron-userland/electron-installer-debian#options)：`maintainer` 默认 `package.author.name <package.author.email>`，`categories` 默认 `GNOME`、`GTK`、`Utility`。
- [Debian Policy 5.6.2 Maintainer](https://www.debian.org/doc/debian-policy/ch-controlfields.html#maintainer)
- [freedesktop 桌面菜单规范](https://specifications.freedesktop.org/menu-spec/latest/category-registry.html)

## 已知局限

不校验图标文件的尺寸和格式；显式声明的图标路径不检查是否存在；不检查 `desktop` 字段中自定义的 `.desktop` 条目；Forge 的 `options.categories` 不校验取值是否在注册表中。
