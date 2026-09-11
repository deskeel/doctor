# `product-name-ascii`

## 检查什么

在打包配置会产出 DEB 的前提下，检查两件事：

1. **Debian 包名**是否符合 dpkg 规则。electron-builder 的包名取自 `deb.packageName`；未设置时取 `package.json` 的 `name`，`name` 带 scope（`@org/app`）时改用 `productName`。fpm 会自动把大写转小写、把下划线和空格换成连字符，doctor 先做同样的归一再判断。maker-deb 自行把包名清洗成合法形式，不检查。
2. **可执行文件名与安装目录名**是否含非 ASCII 字符。electron-builder 取 `linux.executableName` 或顶层 `executableName`，未设置时安装目录和 `.desktop` 文件名沿用 `productName`；Forge 取 `packagerConfig.executableName`、`packagerConfig.name`，未设置时沿用 `productName`，另检查 maker-deb 的 `options.bin`。

## 为什么在统信 UOS / 银河麒麟上会出问题

- Debian Policy 规定包名只能由小写字母、数字、`+`、`-`、`.` 组成。dpkg-deb 会直接拒绝含非 ASCII 字符的包名，构建失败。
- 可执行文件、`/opt/<名字>` 安装目录、`.desktop` 文件和 `/usr/share/icons` 下的图标文件都会沿用这个名字。非 ASCII 路径在构建机 locale、桌面环境和维护脚本中的表现无法保证一致，且没有真机证据说明 UOS / 麒麟的启动器和图标主题能正确处理。

`productName` 本身可以是中文：它用于窗口标题和启动器显示名，只要可执行文件名另外指定为 ASCII。

## 结果

| 情况 | 严重程度 | 验证方式 |
| --- | --- | --- |
| 推导出的 DEB 包名不符合 dpkg 规则（含非 ASCII 或其他非法字符） | error | local |
| `executableName` 含非 ASCII 字符 | warning | local |
| 未设置 `executableName` 且 `productName` 含非 ASCII 字符 | warning | local |
| Forge：`packagerConfig.executableName` / `name` / `productName` 推导出的可执行文件名含非 ASCII 字符 | warning | local |
| Forge：maker-deb `options.bin` 含非 ASCII 字符 | warning | local |

打包配置不产出 DEB、或配置无法静态读取时不输出结果。

## 怎么改

electron-builder：

```json
{
  "build": {
    "productName": "办公助手",
    "linux": { "target": ["deb"], "executableName": "office-helper" },
    "deb": { "packageName": "office-helper" }
  }
}
```

Electron Forge：在 `packagerConfig.executableName` 中设置纯 ASCII 名字。

## 依据来源

- [Debian Policy 5.6.7 Package](https://www.debian.org/doc/debian-policy/ch-controlfields.html#package)：包名只允许小写字母、数字、`+`、`-`、`.`。
- [electron-builder `appInfo.ts`](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/appInfo.ts)：`linuxPackageName` 在 `name` 带 scope 时取 `sanitizedProductName`；`productFilename` 取 `executableName` 或 `productName`。
- [electron-builder `FpmTarget.ts`](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/linux/FpmTarget.ts)：包名取 `deb.packageName` 或 `linuxPackageName`；安装目录为 `/opt/<sanitizedProductName>`。
- [fpm `deb.rb`](https://github.com/jordansissel/fpm/blob/main/lib/fpm/package/deb.rb)：自动转小写并把下划线、空格替换为连字符，不处理其他字符。
- [Electron Packager Options](https://electron.github.io/packager/main/interfaces/Options.html)：`executableName` 默认取 `name`，`name` 默认取 `productName`。

## 已知局限

不检查 `desktop` 字段中自定义的 `Exec`；不检查 `artifactName`；对非 ASCII 可执行文件名只给出 warning，因为没有真机证据表明它一定失败。
