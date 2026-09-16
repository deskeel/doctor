import path from 'node:path';
import pkg from '../../package.json' with { type: 'json' };
import type { Finding } from '../types.ts';
import {
  type ArchiveLimits,
  archiveLimits,
  decompress,
  parseAr,
  parseTar,
  readBounded,
  resolveEntry,
  type TarEntry,
} from './archive.ts';
import {
  type Coverage,
  issue,
  type PackagingOptions,
  RULESET_VERSION,
  SOURCES,
  validatePackagingOptions,
  vendorProfile,
} from './profile.ts';

export interface InspectOptions extends PackagingOptions {
  limits?: Partial<ArchiveLimits>;
}
export interface InspectReport {
  schemaVersion: 1;
  inputType: 'deb';
  doctorVersion: string;
  input: string;
  context: { target: PackagingOptions['target'] | null; channel: PackagingOptions['channel'] | null };
  rulesetVersion: string;
  completion: 'complete' | 'incomplete';
  coverage: Coverage[];
  findings: Finding[];
  control: Record<string, string>;
  scripts: string[];
  compression: string[];
  summary: { error: number; warning: number; info: number; device: number };
  exitCode: 0 | 1 | 2;
}
const RULES = [
  'deb-container',
  'deb-control',
  'deb-layout',
  'deb-desktop',
  'deb-icon',
  'deb-uos-info',
  'deb-permissions',
  'deb-scripts',
  'deb-runtime',
];
const decoder = new TextDecoder('utf-8', { fatal: true });
export function parseControl(text: string): Record<string, string> {
  const fields: Record<string, string> = Object.create(null);
  let key = '';
  let ended = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim()) {
      if (key) ended = true;
      continue;
    }
    if (ended) throw new Error('control 包含多个段落');
    if (/^[ \t]/.test(line)) {
      if (!key) throw new Error('control 无字段的续行');
      fields[key] += `\n${line.trim()}`;
      continue;
    }
    const match = /^([A-Za-z0-9][-A-Za-z0-9]*):[ \t]*(.*)$/.exec(line);
    if (!match) throw new Error('control 字段语法无效');
    key = (match[1] ?? '').toLowerCase();
    if (Object.hasOwn(fields, key)) throw new Error(`control 重复字段 ${key}`);
    fields[key] = match[2] ?? '';
  }
  return fields;
}
export function validDebVersion(value: string): boolean {
  const colon = value.indexOf(':');
  if (colon !== -1 && !/^[0-9]+$/.test(value.slice(0, colon))) return false;
  const rest = colon === -1 ? value : value.slice(colon + 1);
  if (!/^[0-9][A-Za-z0-9.+:~-]*$/.test(rest)) return false;
  return !rest.includes('-') || /^[A-Za-z0-9+.~]+$/.test(rest.slice(rest.lastIndexOf('-') + 1));
}
export function parseDesktop(text: string): Record<string, string> {
  const fields: Record<string, string> = Object.create(null);
  let section = '';
  const groups = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1);
      if (groups.has(section)) throw new Error(`desktop 重复组 ${section}`);
      groups.add(section);
      continue;
    }
    if (section !== 'Desktop Entry') continue;
    const eq = line.indexOf('=');
    if (eq < 1) throw new Error('desktop 字段语法无效');
    const key = line.slice(0, eq);
    if (Object.hasOwn(fields, key)) throw new Error(`desktop 重复字段 ${key}`);
    fields[key] = line.slice(eq + 1);
  }
  if (!groups.has('Desktop Entry')) throw new Error('缺少 [Desktop Entry]');
  return fields;
}
function executable(exec: string): string | null {
  // Desktop Entry quoting is not shell quoting. Wrappers, escapes and variables remain unknown.
  const match = /^(?:"([^"\\]+)"|([^\s"'\\]+))(?:\s|$)/.exec(exec);
  const first = match?.[1] ?? match?.[2];
  return first &&
    !/[$%`]/.test(first) &&
    !['env', 'sh', 'bash', 'dash', 'zsh', 'sudo', 'pkexec'].includes(path.posix.basename(first))
    ? first
    : null;
}
export async function inspectDeb(file: string, options: InspectOptions = {}): Promise<InspectReport> {
  validatePackagingOptions(options);
  const limits = archiveLimits(options.limits);
  const report: InspectReport = {
    schemaVersion: 1,
    inputType: 'deb',
    doctorVersion: pkg.version,
    input: path.resolve(file),
    context: { target: options.target ?? null, channel: options.channel ?? null },
    rulesetVersion: RULESET_VERSION,
    completion: 'incomplete',
    coverage: RULES.map((ruleId) => ({ ruleId, status: 'incomplete', detail: '尚未执行' })),
    findings: [],
    control: {},
    scripts: [],
    compression: [],
    summary: { error: 0, warning: 0, info: 0, device: 0 },
    exitCode: 2,
  };
  const coverage = (id: string, status: Coverage['status'], detail: string) => {
    const item = report.coverage.find((c) => c.ruleId === id);
    if (item) Object.assign(item, { status, detail });
  };
  const add = (
    id: string,
    severity: Finding['severity'],
    title: string,
    evidence: string[],
    source = SOURCES.deb,
    detail?: string,
    fix?: string,
    verification?: Finding['verification'],
  ) => report.findings.push(issue(id, severity, title, evidence, source, detail, fix, verification));
  const profile = vendorProfile(options);
  const vendorSource = profile === 'uos' ? SOURCES.uos : SOURCES.kylin;
  let phase = 'deb-container';
  try {
    const ar = parseAr(await readBounded(file, limits.inputBytes, limits.timeoutMs), limits);
    const archives: Map<string, TarEntry>[] = [];
    let remaining = limits.expandedBytes;
    let remainingEntries = limits.entries;
    for (const part of ['control', 'data']) {
      const name = [...ar.keys()].find((n) => n.startsWith(`${part}.tar`));
      if (!name) throw new Error(`缺少 ${part}`);
      report.compression.push(name);
      const tar = await decompress(name, ar.get(name) as Buffer, remaining, limits.timeoutMs, {
        ...limits,
        entries: remainingEntries,
      });
      remaining -= tar.length;
      const entries = parseTar(tar, { ...limits, entries: remainingEntries });
      remainingEntries -= entries.size;
      for (const entry of entries.values()) if (entry.link !== undefined) resolveEntry(entries, entry.name);
      // Directory symlinks make descendant interpretation ambiguous; do not silently treat descendants as ordinary files.
      for (const entry of entries.values()) {
        let parent = path.posix.dirname(entry.name);
        while (parent !== '.') {
          if (entries.has(parent) && entries.get(parent)?.type !== '5')
            throw new Error(`非普通目录包含归档子条目 ${entry.name}`);
          parent = path.posix.dirname(parent);
        }
      }
      archives.push(entries);
    }
    const extras = [...ar.keys()].slice(3);
    if (extras.length)
      add(
        'deb-container',
        'info',
        '额外 ar 成员未解释或验签',
        extras,
        SOURCES.deb,
        '只检查成员头、唯一性和体积；签名成员存在不代表签名有效。',
      );
    let unresolvedLinks = 0;
    for (const [index, entries] of archives.entries())
      for (const entry of entries.values()) {
        if (entry.link !== undefined && !resolveEntry(entries, entry.name)) {
          unresolvedLinks++;
          add('deb-container', 'info', '链接目标不在包内，需目标环境确认', [
            `${index === 0 ? 'control' : 'data'}.tar/${entry.name} -> ${entry.link}`,
          ]);
        }
      }
    const controlEntries = archives[0] as Map<string, TarEntry>;
    const data = archives[1] as Map<string, TarEntry>;
    coverage(
      'deb-container',
      unresolvedLinks || extras.length ? 'unknown' : 'complete',
      `已解析 ${ar.size} 个 ar 成员；${controlEntries.size + data.size} 个 tar 条目；没有落盘解包`,
    );
    phase = 'deb-control';
    const control = controlEntries.get('control');
    if (control?.type !== '0') throw new Error('control 必须是普通文件');
    report.control = parseControl(decoder.decode(control.data));
    const c = report.control;
    for (const key of ['package', 'version', 'architecture', 'maintainer', 'description'])
      if (!c[key]?.trim()) add(phase, 'error', `control 缺少 ${key}`, ['control'], SOURCES.deb);
    const name = c.package ?? '';
    const version = c.version ?? '';
    const arch = c.architecture ?? '';
    if (!/^[a-z0-9][a-z0-9+.-]+$/.test(name)) add(phase, 'error', 'Package 不符合 Debian 包名语法', [name]);
    if (!validDebVersion(version)) add(phase, 'error', 'Version 不符合 Debian 版本语法', [version]);
    if (profile === 'uos' && arch === 'amd64' && !/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(name))
      add(phase, 'error', 'UOS 商店包名应使用小写倒置域名', [name], vendorSource);
    if (profile === 'kylin' && arch === 'amd64' && !/^[a-z][a-z0-9+.-]+$/.test(name))
      add(phase, 'error', '麒麟包名应以字母开头', [name], vendorSource);
    if (
      profile &&
      (path.basename(file).length > 255 ||
        path.basename(file) !== `${name}_${version.replace(/^[0-9]+:/, '')}_${arch}.deb`)
    )
      add(
        phase,
        'warning',
        'DEB 文件名与 control 的标准命名不一致',
        [path.basename(file), `${name}_${version.replace(/^[0-9]+:/, '')}_${arch}.deb`],
        vendorSource,
      );
    if (c.priority && !['required', 'important', 'standard', 'optional', 'extra'].includes(c.priority))
      add(phase, 'warning', 'Priority 不是已知 Debian 值', [c.priority]);
    if (
      c.section &&
      !new Set(
        'admin cli-mono comm database debug devel doc editors education electronics embedded fonts games gnome gnustep graphics hamradio haskell httpd interpreters introspection java javascript kde kernel libdevel libs lisp localization mail math metapackages misc net news ocaml oldlibs otherosfs perl php python r ruby rust science shells sound tasks tex text utils vcs video web x11 xfce zope'.split(
          ' ',
        ),
      ).has(c.section.replace(/^(?:contrib|non-free|non-free-firmware)\//, ''))
    )
      add(phase, 'warning', 'Section 不在内置 Debian 分类清单，需确认', [c.section]);
    coverage(
      phase,
      arch === 'amd64' ? 'complete' : 'unknown',
      arch === 'amd64'
        ? '静态字段已检查；依赖完整性及系统库 ABI 未验证'
        : `Architecture=${arch}，本轮厂商规则仅覆盖 amd64`,
    );
    if (arch !== 'amd64') add(phase, 'info', '架构超出本轮 amd64 验证范围', [arch], vendorSource);
    const active = Boolean(profile) && arch === 'amd64';
    const base = `opt/apps/${name}`;
    phase = 'deb-layout';
    if (active) {
      const prefixes =
        profile === 'uos'
          ? [`${base}/files/`, `${base}/entries/`]
          : [`${base}/`, 'usr/share/applications/', 'usr/share/icons/hicolor/'];
      for (const prefix of prefixes)
        if (![...data.keys()].some((n) => n.startsWith(prefix)))
          add(phase, 'error', `缺少目标目录内容 /${prefix}`, [base], vendorSource);
      coverage(phase, 'complete', '检查目标目录静态布局；未验证安装器映射');
    } else
      coverage(
        phase,
        profile ? 'unknown' : 'not-applicable',
        '未指定适用的目标/渠道，或架构不在范围；没有推定商店要求',
      );
    phase = 'deb-uos-info';
    if (active && profile === 'uos') {
      const info = resolveEntry(data, `${base}/info`);
      if (info?.type !== '0') add(phase, 'error', '缺少 UOS info 普通文件', [`${base}/info`], SOURCES.uos);
      else {
        try {
          const v: unknown = JSON.parse(decoder.decode(info.data));
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('info 顶层必须是对象');
          const i = v as Record<string, unknown>;
          for (const [key, expected] of [
            ['appid', name],
            ['version', version],
          ])
            if (i[key as string] !== expected)
              add(
                phase,
                'error',
                `info.${key} 与 control 不一致`,
                [JSON.stringify(i[key as string]), String(expected)],
                SOURCES.uos,
              );
          if (!Array.isArray(i.arch) || !i.arch.every((a) => typeof a === 'string') || !i.arch.includes(arch))
            add(phase, 'error', 'info.arch 应为包含 control 架构的字符串数组', [JSON.stringify(i.arch)], SOURCES.uos);
          for (const key of ['permissions'])
            if (!Object.hasOwn(i, key) || !i[key] || typeof i[key] !== 'object' || Array.isArray(i[key]))
              add(phase, 'error', `info.${key} 应为对象`, [info.name], SOURCES.uos);
          if (i.permissions && typeof i.permissions === 'object')
            for (const [key, value] of Object.entries(i.permissions))
              if (typeof value !== 'boolean')
                add(
                  phase,
                  [
                    'autostart',
                    'notification',
                    'trayicon',
                    'clipboard',
                    'account',
                    'bluetooth',
                    'camera',
                    'audio_record',
                    'installed_apps',
                  ].includes(key)
                    ? 'error'
                    : 'warning',
                  `info.permissions.${key} 不是布尔值，需确认权限定义`,
                  [JSON.stringify(value)],
                  SOURCES.uos,
                );
          if (!/^\d+\.\d+\.\d+\.\d+$/.test(version))
            add(
              phase,
              'warning',
              'UOS 四段版本描述与官方三段示例冲突',
              [version],
              SOURCES.uos,
              '保留 Debian 合法版本；不能据此认定厂商拒绝。',
              '向目标商店确认版本口径。',
            );
        } catch (e) {
          add(phase, 'error', 'UOS info JSON 无效', [String(e)], SOURCES.uos);
        }
      }
      coverage(phase, 'complete', 'JSON、标识、版本、架构与权限类型；权限语义仍需厂商确认');
    } else coverage(phase, 'not-applicable', '仅适用 UOS 商店 amd64');
    phase = 'deb-desktop';
    const desktops = [...data.values()].filter((e) => e.name.endsWith('.desktop'));
    if (active && !desktops.length) add(phase, 'error', '目标包缺少 desktop 文件', [base], vendorSource);
    let refsUnknown = false;
    for (const entry of desktops) {
      try {
        const actual = resolveEntry(data, entry.name);
        if (actual?.type !== '0') throw new Error('desktop 引用无法解析为普通文件');
        const desktop = parseDesktop(decoder.decode(actual.data));
        const required =
          active && profile === 'uos'
            ? ['Name', 'Exec', 'Icon', 'Type', 'Terminal', 'StartupNotify']
            : active
              ? ['Name', 'Name[zh_CN]', 'Exec', 'Icon', 'Type']
              : ['Name', 'Type'];
        for (const key of required)
          if (!desktop[key])
            add(phase, 'error', `desktop 缺少 ${key}`, [entry.name], active ? vendorSource : SOURCES.desktop);
        if (desktop.Type && desktop.Type !== 'Application')
          add(phase, 'warning', 'desktop 不是 Application 类型', [entry.name, desktop.Type], SOURCES.desktop);
        for (const key of ['Terminal', 'StartupNotify'])
          if (desktop[key] !== undefined && !['true', 'false'].includes(desktop[key] as string))
            add(phase, 'error', `desktop ${key} 应为 true/false`, [entry.name], SOURCES.desktop);
        if (
          active &&
          !(profile === 'uos'
            ? entry.name.startsWith(`${base}/entries/applications/`)
            : entry.name.startsWith('usr/share/applications/'))
        )
          add(phase, 'warning', 'desktop 不在目标标准入口目录', [entry.name], vendorSource);
        if (desktop.Exec) {
          const exec = executable(desktop.Exec);
          if (/(?:^|\s)--(?:no-sandbox|disable-setuid-sandbox)(?:\s|$)/.test(desktop.Exec))
            add(
              phase,
              'warning',
              'Exec 显式关闭 sandbox',
              [entry.name, desktop.Exec],
              SOURCES.sandbox,
              '不能从 MIPS 4755 示例推导 amd64 策略。',
              '在目标 amd64 系统验证 sandbox，不默认关闭或设置 SUID。',
              'device',
            );
          if (exec?.startsWith('/')) {
            const executableEntry = resolveEntry(data, exec);
            if (!executableEntry) {
              refsUnknown = true;
              add(
                phase,
                exec.startsWith(`/${base}/`) ? 'error' : 'warning',
                'Exec 绝对路径不在包内，可能依赖外部安装内容',
                [entry.name, exec],
                SOURCES.desktop,
              );
            } else if (executableEntry.type !== '0' || !(executableEntry.mode & 0o111))
              add(phase, 'error', 'Exec 目标不是可执行普通文件', [entry.name, exec], SOURCES.desktop);
          } else {
            refsUnknown = true;
            add(
              phase,
              'info',
              'Exec 依赖 PATH、包装器或动态语法，无法证明最终目标',
              [entry.name, desktop.Exec],
              SOURCES.desktop,
            );
          }
        }
        if (
          active &&
          profile === 'kylin' &&
          entry.name.startsWith('usr/share/applications/') &&
          path.posix.basename(entry.name) !== `${name}.desktop`
        )
          add(phase, 'warning', '麒麟 desktop 文件名与 Package 不一致', [entry.name, `${name}.desktop`], SOURCES.kylin);
        const icon = desktop.Icon;
        if (icon) {
          if (icon.startsWith('/')) {
            if (!/\.(png|svg|xpm)$/i.test(icon))
              add(
                'deb-icon',
                'warning',
                'Icon 路径扩展名不在 PNG/SVG/XPM 支持范围',
                [entry.name, icon],
                SOURCES.desktop,
              );
            if (active && profile === 'kylin' && !/\.(png|svg)$/i.test(icon))
              add('deb-icon', 'warning', '麒麟图标规范要求 PNG/SVG', [entry.name, icon], SOURCES.kylin);
            const found = resolveEntry(data, icon);
            if (found?.type !== '0') {
              refsUnknown = true;
              add(
                'deb-icon',
                icon.startsWith(`/${base}/`) ? 'error' : 'warning',
                'Icon 绝对路径未解析为包内文件',
                [entry.name, icon],
                SOURCES.desktop,
              );
            }
          } else if (icon.includes('/'))
            add('deb-icon', 'error', 'Icon 相对路径不符合主题名或绝对路径约定', [entry.name, icon], SOURCES.desktop);
          else {
            const candidates = [...data.keys()].filter(
              (n) =>
                /\.(png|svg|xpm)$/i.test(n) &&
                path.posix.basename(n).replace(/\.(png|svg|xpm)$/i, '') === icon &&
                (n.startsWith('usr/share/icons/') ||
                  n.startsWith('usr/share/pixmaps/') ||
                  n.startsWith(`${base}/entries/icons/`)),
            );
            if (!candidates.some((n) => resolveEntry(data, n)?.type === '0')) {
              refsUnknown = true;
              add(
                'deb-icon',
                'info',
                'Icon 主题名未匹配包内候选，目标主题可能提供',
                [entry.name, icon],
                SOURCES.desktop,
              );
            }
          }
        }
      } catch (e) {
        add(phase, 'error', 'desktop 解析失败', [entry.name, String(e)], SOURCES.desktop);
      }
    }
    coverage(
      phase,
      refsUnknown ? 'unknown' : 'complete',
      `${desktops.length} 个 desktop；未执行 Exec；外部/PATH 引用不能证明`,
    );
    coverage('deb-icon', refsUnknown ? 'unknown' : 'complete', '仅引用路径和主题候选；未解码图像或审计 PNG 尺寸');
    phase = 'deb-permissions';
    for (const e of [...controlEntries.values(), ...data.values()]) {
      const facts = [`${e.name}: uid=${e.uid} gid=${e.gid} mode=${e.mode.toString(8)}`];
      if (e.mode & 0o6000)
        add(
          phase,
          active && profile === 'uos' && e.mode & 0o4000 ? 'error' : 'warning',
          '归档含 SUID/SGID 权限',
          facts,
          active && profile === 'uos' ? SOURCES.security : SOURCES.sandbox,
        );
      if (e.type !== '2' && e.mode & 0o022)
        add(
          phase,
          active && profile === 'uos' ? 'error' : 'warning',
          '归档条目允许组或其他用户写入',
          facts,
          active && profile === 'uos' ? SOURCES.security : SOURCES.deb,
        );
      if (active && profile === 'uos' && (e.uid !== 0 || e.gid !== 0))
        add(phase, 'error', 'UOS 商店条目并非 root:root 所有', facts, SOURCES.security);
      if (active && profile === 'uos' && e.type !== '5') {
        const restricted = [
          'usr/share/dbus-1/system.d/',
          'usr/share/dbus-1/services/',
          'usr/share/dbus-1/system-services/',
          'etc/systemd/system/',
          'usr/share/ca-certificates/deepin/',
          'etc/ssl/certs/',
          'usr/local/share/ca-certificates/',
          'var/lib/deepin/developer-mode/',
          'sys/kernel/security/',
        ];
        if (restricted.some((prefix) => e.name.startsWith(prefix)))
          add(phase, 'error', 'UOS 审核规范禁止的服务或安全目录条目', facts, SOURCES.security);
        else if (
          ['etc/', 'var/lib/', 'var/cache/', 'usr/'].some((prefix) => e.name.startsWith(prefix)) &&
          ![
            'etc/systemd/user/',
            'usr/share/applications/',
            'usr/share/icons/',
            `etc/${name}/`,
            `var/lib/${name}/`,
            `var/cache/${name}/`,
            `usr/${name}/`,
          ].some((prefix) => e.name.startsWith(prefix))
        )
          add(phase, 'warning', '条目在 UOS 受限系统目录内，需确认白名单', facts, SOURCES.security);
      }
      if (active && profile === 'kylin' && /\.(deb|rpm)$/i.test(e.name))
        add('deb-layout', 'warning', '包内疑似嵌套软件包，需确认麒麟规范', [e.name], SOURCES.kylin);
    }
    coverage(phase, 'unknown', '已检查 tar UID/GID/mode；未验证 capabilities、ACL、安全策略或运行时权限');
    phase = 'deb-scripts';
    report.scripts = ['preinst', 'postinst', 'prerm', 'postrm'].filter((n) => controlEntries.has(n));
    for (const name of report.scripts)
      add(
        phase,
        active && profile === 'uos' ? 'warning' : 'info',
        `包含维护脚本 ${name}（未执行）`,
        [`control.tar/${name}`],
        profile === 'uos' ? `${SOURCES.uos}; ${SOURCES.security}` : SOURCES.kylin,
        profile === 'uos'
          ? 'UOS 审核页禁止四类脚本，打包页允许有限自身操作，两者存在政策冲突。'
          : '仅枚举脚本，未做 ShellCheck 或安全证明。',
        '人工审查必要操作并向交付渠道确认政策。',
      );
    coverage(phase, 'complete', `已枚举四类维护脚本：${report.scripts.join(', ') || '无'}；未执行或审计脚本`);
    report.completion = 'complete';
  } catch (error) {
    add(phase, 'error', '检查未完成', [error instanceof Error ? error.message : String(error)]);
    coverage(phase, 'incomplete', '输入读取、结构解析或资源限制失败；不能报告通过');
  }
  add(
    'deb-runtime',
    'info',
    '签名信任、sandbox 与安装/运行行为需要目标机验证',
    [options.target ?? 'target 未指定', options.channel ?? 'channel 未指定'],
    `${SOURCES.trust}; ${SOURCES.sandbox}`,
    '未验签、安装、执行脚本、联网或验证 ABI；签名成员存在不能证明信任。',
    '在准确目标镜像验证签名、安全策略、安装、启动与升级。',
    'device',
  );
  coverage('deb-runtime', 'unknown', '未执行；静态检查不构成厂商审核或真机兼容结论');
  for (const f of report.findings) {
    report.summary[f.severity]++;
    if (f.verification === 'device') report.summary.device++;
  }
  report.exitCode = report.completion === 'incomplete' ? 2 : report.summary.error ? 1 : 0;
  return report;
}
export function renderInspectText(report: InspectReport): string {
  return [
    `DeskKeel Doctor v${report.doctorVersion} — DEB inspect`,
    `输入：${report.input}`,
    `目标：${report.context.target ?? '未指定'} / 渠道：${report.context.channel ?? '未指定'}`,
    `规则集：${report.rulesetVersion}；完成状态：${report.completion}`,
    ...report.coverage.map((c) => `[${c.ruleId}] ${c.status}: ${c.detail}`),
    ...report.findings.flatMap((f) => [
      `[${f.severity}] [${f.ruleId}] ${f.title}`,
      `  原因：${f.detail}`,
      `  建议：${f.fix}`,
      ...(f.evidence ?? []).map((e) => `  依据：${e}`),
      `  来源：${f.source}`,
    ]),
    `结果：${report.summary.error} 错误，${report.summary.warning} 警告，${report.summary.info} 提示；退出码 ${report.exitCode}`,
    '',
  ].join('\n');
}
