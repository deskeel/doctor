# 目标规范预检与只读 DEB inspect

规则集版本：`2026-09-16.1`。核对日期：2026-09-16。适用产品为 UOS 桌面 V20、银河麒麟桌面 V10；厂商规则仅对 amd64 产物作本轮判断。目标规范与原生模块 ABI 检查是独立维度，没有实现完整系统库 ABI Profile。

## 上下文与兼容性

- 无参数工程检查仍执行原有 9 条规则，JSON schemaVersion=1，字段与退出码语义保持兼容。文本显示目标/渠道未指定。
- `--target uos-v20|kylin-v10` 激活可选静态工程检查；`--channel store|direct|enterprise` 必须配合 target。不猜测渠道。
- UOS 厂商商店规则只在 `uos-v20 + store` 激活。direct/enterprise 不套用商店政策。
- 麒麟 V10 的通用 DEB 打包规则在显式任一渠道时激活；没有据此增加商店或企业专属要求。仅指定 target 时保留通用检查，并将厂商布局标记为不适用。
- 工程报告新增可选 `packaging`，包含目标、渠道、规则集版本和覆盖。新增 findings 可带可选 `source`。原有 `rules` 仍表示执行的原有 Rule 集合；扩展规则见 `packaging.coverage`。
- inspect 是独立 schema：`schemaVersion: 1, inputType: "deb"`。同时包含 `doctorVersion`、`input`、`context`、`rulesetVersion`、`completion`、`coverage`、`findings`、`control`（字段名归一为小写）、`scripts`、`compression`、`summary`、`exitCode`。

`complete` 只表示约定静态解析阶段完成，不等于规则无错误、兼容通过或厂商审核通过。每组 coverage 独立使用 `complete / not-applicable / unknown / incomplete`；规则被跳过或运行行为未验证不会显示为通过。`unknown` 的运行检查始终保留，读入或解压未完成为 `incomplete`。

## 工程规则

| 稳定 ID | 适用与级别 | 检查、证据与改法 |
| --- | --- | --- |
| `packaging-config` | 显式 target；info/local | JS/TS、继承、钩子、打包目录覆盖等不能推导最终产物时说明覆盖不足；不执行配置。证据为配置文件定位，改为可静态读取配置或 inspect 产物。 |
| `packaging-name` | 显式 target；error/info/local | 复用原有 electron-builder 包名推导与 fpm 归一逻辑，区分 appId、productName、Package。scope 名使用 productName；Forge 仅对无需推测清洗结果的显式 options.name 判定。动态覆盖、继承或 staged metadata 不确定时 unknown。修正最终 Package。 |
| `packaging-scripts` | 显式 target；warning/info/local | electron-builder afterInstall/afterRemove、fpm 四类维护脚本及 after-upgrade 参数；Forge options.scripts。检查入口、文件存在与类型、工程内 realpath 边界；不执行/读取脚本内容。不推断默认脚本不存在。UOS 商店源文冲突用 warning，请渠道确认。 |
| `packaging-desktop` | 显式 target；warning/info/local | 显式 desktop 字段类型、布尔字符串，Forge desktopTemplate 路径；打包器可生成缺省字段，未声明只报告 unknown。安装后路径不能以工程缺文件判错。 |
| `packaging-updater` | 仅 UOS/store；warning/local | electron-updater 依赖或 publish 配置是可观察线索，不能证明启用自更新；核对实际行为与商店机制。 |
| `packaging-sandbox` | 显式 target；warning/local | 仅扫描显式启动配置中的 no-sandbox/disable-setuid-sandbox，不扫描任意业务源码。修复前在目标 amd64 系统验证，不默认设置 4755。 |

## inspect 规则

| 稳定 ID | 适用与级别 | 检查、边界与改法 |
| --- | --- | --- |
| `deb-container` | 所有输入；error/local | ar 魔数、成员顺序/唯一性、debian-binary=2.0、control/data 唯一性、tar checksum/结束块、危险路径与链接循环。错误或不支持特性使 completion=incomplete、exit=2；重打合法包。额外 ar 成员不会被当成可信签名。 |
| `deb-control` | Debian 通用 + 显式厂商 profile；error/warning/info/local | 必填字段、重复字段、包名、Debian epoch/upstream/revision 版本语义；文件名与元数据一致性提示；Section/Priority 非已知值提示。非 amd64 厂商内容检查标为范围外。依赖是否完整与真实 ABI 未验证。 |
| `deb-layout` | 对应 target/channel，amd64；error/warning/local | UOS /opt/apps/Package/{entries,files,info}；麒麟 /opt/apps/Package、/usr/share/applications、hicolor。疑似嵌套包提示；修正布局。没有证明安装器映射或系统修改行为。 |
| `deb-desktop` | 通用语法 + 厂商必填；error/warning/info/local，sandbox 为 device | UTF-8、Desktop Entry、重复组/字段、必填字段、布尔值、显式 Exec 第一项。支持双引号绝对路径、后续参数与 %U 等占位符；PATH/env/包装器/转义或动态表达式无法证明最终目标则 unknown。包内 Exec 检查普通文件与执行位；外部引用需目标验证。 |
| `deb-icon` | 所有 desktop；error/warning/info/local | 绝对路径或图标主题名，候选 png/svg/xpm 引用与链接。合法主题名未在包内找到只提示外部主题可能提供；相对路径不合法。没有解码图片、验证全部尺寸或实际显示效果。 |
| `deb-uos-info` | 仅 UOS/store amd64；error/warning/local | JSON 对象、appid/version 与 control 对齐，arch 为包含当前架构的字符串数组，permissions 对象及已知布尔字段。四段版本文字与三段示例矛盾，仅 warning；未知权限语义需确认。 |
| `deb-permissions` | 通用权限事实；UOS/store amd64 加政策；error/warning/local | tar UID/GID/mode，组/其他可写与 SUID/SGID；UOS root:root、明确受限服务/证书/开发者目录，其他受限目录白名单需人工确认。目录符号链接不能带归档子条目。ACL/capabilities 没有完整审计，coverage=unknown；文件 root 所有不代表运行时提权。 |
| `deb-scripts` | 所有输入；warning/info/local | 列出 control.tar 中 preinst/postinst/prerm/postrm；UOS/store 政策冲突 warning。无执行、字符串安全证明或 ShellCheck。 |
| `deb-runtime` | 所有输入；info/device，unknown | 未验签、安装、运行、测试 sandbox、升级或实际系统依赖。证据为目标/渠道；应在准确镜像验证。签名成员存在不构成信任结论。 |

所有 findings 带稳定 ID、严重程度、local/device、原因、改法、来源与实际证据。报告上下文与此表共同定义适用性。

## 解析支持与资源安全

| 格式 | 支持 |
| --- | --- |
| ar + 普通/USTAR tar | 内置；普通文件、目录、符号/硬链接，常见 `./` 根归一 |
| gzip (`.tar.gz`) | Node zlib；不依赖外部命令 |
| xz (`.tar.xz`) | PATH 中本机 xz，固定参数，解压内存限制 256 MiB |
| zstd (`.tar.zst`) | PATH 中本机 zstd，固定参数，窗口内存限制 256 MB |
| bzip2/lzma/其他压缩 | 未支持，结构化 incomplete，exit=2 |
| PAX、GNU longname/longlink、base-256、稀疏文件、设备/FIFO | 当前未支持，结构化 incomplete，exit=2；不能据未检查特性认定包不合规 |

不安装工具、不使用 shell、不把输入路径拼入外部命令；只将归档字节经 stdin 交给受信任的本机 xz/zstd。用户需保证 PATH 中工具可信。工具缺失、异常、超时或不兼容参数都返回 incomplete。无联网、上传、签名、验签、安装、执行用户配置/维护脚本或解包写文件。只读输入为普通文件。

默认硬上限：输入 512 MiB；control+data 总展开量 1 GiB；单条目 256 MiB；总 tar 条目 100,000；ar 成员 32；每次输入读取/压缩流 30 秒。程序 API 可通过 `limits` 降低上限，不能提升。读取与解压流在积累超限之前终止；tar 条目数与单条目大小也在解压收到 header 时检查。受限缓冲用于结构解析，峰值内存可能高于展开量（原始输入、收集分块和拼接缓冲并存），不是恒定内存解析器。拒绝绝对归档路径、`..`、反斜线和重复归一化条目；绝对链接按包根解释，最多解析 128 层且不访问宿主路径。链接循环/越界失败，外部断链不宣称已验证。

退出码：`0` 静态检查完成且无 error（仍可能有 warning/unknown）；`1` 静态检查完成且存在规则 error；`2` 用法、输入读取、解析、工具或资源限制导致未完成。CLI 用法错误写 stderr；inspect 输入错误仍输出结构化报告。无 target 的工程 warning 与原有规则一样不改变退出码。

## 直接技术来源与冲突

以下是官方原文定位；运行时不联网获取规则。2026-09-16 通过官网文档公开接口重新核对 U1/U2，下载核对 K1/K3/K4 原 PDF。不保存完整第三方手册。

- [U1 应用打包规范](https://uosdn.uniontech.com/#document3?dirid=656ef27dbd766615b0b0300e&id=65702eaebd766615b0b0310d)：修改时间 2026-06-16；§1 Package，§2 安装与脚本例外，§3.1.1 desktop，§3.3 info，§4 文件系统，§6 脚本。页面通过 `https://ecology.chinauos.com/api/doc/doc?id=65702eaebd766615b0b0310d&type=document` 返回正文。
- [U2 应用审核规范](https://uosdn.uniontech.com/#document3?dirid=656ef27dbd766615b0b0300e&id=65703321bd766615b0b0311d)：§3 安全检测表、§4.3(4)/(8) 更新机制。四类维护脚本禁令与 U1 有限自身操作描述冲突；不能声称厂商规则无歧义。U1 四段数字版本文字与三段示例冲突；保留合法 Debian 版本，提示渠道确认。
- [K1 V10 DEB 包打包规范](https://www.kylinos.cn/upload/1/editor/20251223/1766460055548.pdf)：V1.13（2025-12-08 模板变更）；§2 命名、§3.1 control、§3.2 安装目录、§3.3 desktop、§3.4 图标、§3.5 系统修改与脚本；PDF 第 5–11 页。该文档是打包规范，不推定额外渠道审核政策。
- [K3 V10 Electron 打包指南](https://www.kylinos.cn/upload/1/editor/20251223/1766460381009.pdf)：§2.4.5 x86 二次打包；§4 MIPS 的 chrome-sandbox 4755 示例不适用于推导 amd64 强制策略。
- [K4 V10 FAQ](https://www.kylinos.cn/upload/1/kycms/20250617/1934877956515139584.pdf)：PDF 第 19 页、正文第 17 页“应用保护”，来源控制模式决定未签名包的处理；静态包检查不能证明目标信任。
- [Debian control §5](https://www.debian.org/doc/debian-policy/ch-controlfields.html)、[deb(5)](https://manpages.debian.org/deb.5)、[tar(5)](https://manpages.debian.org/tar.5)、[Desktop Entry Exec](https://specifications.freedesktop.org/desktop-entry-spec/latest/exec-variables.html)。
- [electron-builder FpmTarget](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/linux/FpmTarget.ts)、[Linux options](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/options/linuxOptions.ts)、[electron-installer-debian options](https://github.com/electron-userland/electron-installer-debian#options)。推导无法确定的版本/覆盖不执行配置来补齐。

## 验证与待验证

合成标准 DEB 覆盖未压缩/gzip/xz/zstd、目标渠道矩阵、control/desktop/info/权限/脚本失败、危险路径/链接/重复/截断/资源上限。宿主 ar/tar 验证合成结构，输入摘要与目录内容验证只读。缺本机解压工具不跳过产品失败处理；可选 codec 的成功测试在工具缺失平台注明未执行。

真机安装、厂商审核、签名信任、sandbox、N→N+1 升级、三份真实客户工程/包效果与跨平台外部解压器仍需要独立验证。合成检查不能替代这些结论。
