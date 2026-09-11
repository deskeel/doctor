# 参与贡献

感谢你关注 DeskKeel Doctor。这份文档说明开发环境、代码规范和规则编写要求。

## 开发环境

- Node.js 22 或更高（`.nvmrc` 指定 22）。运行时支持 Node 20.10 以上，但开发和测试直接执行 TypeScript 源码，需要 Node 22 的类型剥离能力。
- pnpm 10，版本由 `package.json` 的 `packageManager` 字段固定，推荐通过 Corepack 启用。

```bash
pnpm install
pnpm check      # 类型检查 + Biome + 测试
pnpm build      # 输出到 dist/
pnpm smoke      # 对 dist/ 做端到端冒烟
pnpm format     # Biome 自动修复格式与可修复的 lint 问题
```

## 代码规范

- TypeScript 严格模式，ESM，`NodeNext` 解析。相对导入写 `.ts` 后缀，构建时由 TypeScript 重写为 `.js`。
- 只使用可擦除的 TypeScript 语法（`erasableSyntaxOnly`）：不用 `enum`、参数属性、命名空间。
- 格式化和 lint 由 Biome 负责，配置在 `biome.json`，CI 会执行 `biome check`。
- 测试使用 Node 内置的 `node:test` 与 `node:assert/strict`，测试文件放在 `test/`，以 `.test.ts` 结尾。
- 面向用户的文案（报告、帮助、README、规则文档）使用中文。代码标识符、提交信息使用英文。
- 运行时依赖保持最少。新增依赖需要在 PR 中说明理由。

## 边界

doctor 是离线的只读工具。以下内容不会被接受：

- 任何遥测、上报、网络请求。
- 读取工程之外的任何配置文件或账号信息。
- 修改用户工程文件的“自动修复”。
- 执行 electron-builder、Forge 或用户工程中的任何脚本。

## 规则编写

每条规则是 `src/rules/` 下的一个文件，导出一个 `Rule` 对象，并在 `src/rules/index.ts` 注册。

### 命名

- `id` 使用小写字母和连字符，描述检查对象而不是结论：`lockfile`、`linux-deb-target`、`native-module-abi`。
- 文件名与 `id` 相同。

### 字段

| 字段 | 要求 |
| --- | --- |
| `title` | 一句话说明规则通过时的状态，例如“锁文件存在、唯一，并与 packageManager 字段一致”。 |
| `description` | 检查什么。 |
| `source` | 阈值或判断依据的来源：官方文档链接、软件仓库记录或真机验证记录。没有来源的规则只能作为候选，不进入 `builtinRules`。 |
| `check` | 返回 `Finding[]`。`context.packageJson` 为 `null` 时直接返回空数组，由 `package-json` 规则负责报告。 |

### Finding

- `severity`：`error` 表示按当前配置无法产出可交付的 DEB 或无法在目标系统运行；`warning` 表示很可能出问题或结论不可复现；`info` 表示 doctor 无法判断、需要用户自行确认。
- `verification`：`local` 表示用户可以在本地修复；`device` 表示必须在统信 UOS / 银河麒麟真机上验证。
- `title` 一句话结论，`detail` 说明为什么在目标系统上会出问题，`fix` 说明怎么改。三者都用中文，避免只给出抽象描述。
- 不要为了制造紧迫感把结论写得比证据更确定。

### 测试与文档

- 在 `test/fixtures/` 下增加最小工程作为 fixture，只放触发规则所需的文件。
- 在 `test/` 下为触发与不触发两种情况各写至少一个断言。
- 在 `docs/rules/<id>.md` 按模板写规则文档，并在 `docs/rules/README.md` 登记。

## 提交与发布

- 提交标题使用 `type: summary`：`feat`、`fix`、`docs`、`chore`、`refactor`、`test`。
- `main` 上的提交会由 release-please 汇总成发布 PR，合并后自动打 tag、生成 CHANGELOG 并发布到 npm。`feat` 提升次版本号，`fix` 提升修订号，标题带 `!` 或正文含 `BREAKING CHANGE` 提升主版本号。
- JSON 报告的字段属于公开接口。删除或改名字段需要递增 `REPORT_SCHEMA_VERSION` 并标记为破坏性变更。
