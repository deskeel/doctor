# 规则文档

每条默认规则对应一篇文档，说明检查什么、为什么在统信 UOS / 银河麒麟上会出问题、怎么改，以及判断依据的来源。新增规则时复制 [`_template.md`](./_template.md)。

| 规则 | 说明 | 严重程度 | 验证方式 |
| --- | --- | --- | --- |
| [package-json](./package-json.md) | 工程根目录包含可解析的 package.json | error | local |
| [electron-dependency](./electron-dependency.md) | electron 声明在 devDependencies 且版本明确 | error / warning | local |
| [lockfile](./lockfile.md) | 锁文件存在、唯一，并与 packageManager 一致 | error / warning | local |
| [linux-deb-target](./linux-deb-target.md) | 打包配置包含 Linux DEB 目标 | error / warning / info | local |
| [deb-metadata](./deb-metadata.md) | DEB 元数据齐全：homepage、maintainer、图标、桌面分类、可执行文件名 | error / warning / info | local |
