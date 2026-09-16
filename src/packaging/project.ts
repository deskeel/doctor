import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { builderPackageName, forgeDebMaker, isRecord, producesDeb } from '../builder/config.ts';
import type { Finding, ProjectContext } from '../types.ts';
import { type Coverage, issue, type PackagingOptions, RULESET_VERSION, SOURCES, vendorProfile } from './profile.ts';
export interface ProjectPackagingReport {
  rulesetVersion: string;
  target: PackagingOptions['target'] | null;
  channel: PackagingOptions['channel'] | null;
  coverage: Coverage[];
}
export async function checkProjectPackaging(
  context: ProjectContext,
  options: PackagingOptions,
): Promise<{ packaging: ProjectPackagingReport; findings: Finding[] }> {
  const findings: Finding[] = [];
  const coverage: Coverage[] = [];
  const profile = vendorProfile(options);
  const packaging: ProjectPackagingReport = {
    rulesetVersion: RULESET_VERSION,
    target: options.target ?? null,
    channel: options.channel ?? null,
    coverage,
  };
  const add = (
    id: string,
    severity: Finding['severity'],
    title: string,
    evidence: string[],
    source = SOURCES.builder,
    detail?: string,
  ) => findings.push(issue(id, severity, title, evidence, source, detail));
  const mark = (ruleId: string, status: Coverage['status'], detail: string) =>
    coverage.push({ ruleId, status, detail });
  const { builder, packageJson: pkg } = context;
  const config = builder?.config;
  if (!pkg || !config || !builder || !producesDeb(builder)) {
    add(
      'packaging-config',
      'info',
      '无法静态确定打包配置，覆盖不足',
      [builder?.file ?? '未检测到配置'],
      SOURCES.builder,
      'JS/TS 配置、钩子和工程代码不会执行。',
    );
    for (const id of [
      'packaging-config',
      'packaging-name',
      'packaging-scripts',
      'packaging-desktop',
      'packaging-updater',
      'packaging-sandbox',
    ])
      mark(id, 'unknown', '缺少可静态读取配置');
    return { packaging, findings };
  }
  const file = builder?.file ?? 'package.json';
  const linux = isRecord(config.linux) ? config.linux : {};
  const deb = isRecord(config.deb) ? config.deb : {};
  const maker = forgeDebMaker(config);
  const forgeOptions = isRecord(maker?.options) ? maker.options : {};
  const dynamic =
    config.extends !== undefined ||
    config.extraMetadata !== undefined ||
    config.beforePack !== undefined ||
    config.afterPack !== undefined ||
    config.beforeBuild !== undefined ||
    config.afterExtract !== undefined ||
    config.afterSign !== undefined ||
    config.fpm !== undefined ||
    deb.fpm !== undefined ||
    linux.fpm !== undefined ||
    (isRecord(config.directories) && config.directories.app !== undefined);
  if (dynamic)
    add(
      'packaging-config',
      'info',
      '继承、钩子或覆盖选项使最终打包结果无法确定',
      [file],
      SOURCES.builder,
      '只检查当前显式配置；未执行钩子或读取继承配置，检查最终 DEB。',
    );
  mark(
    'packaging-config',
    dynamic ? 'unknown' : 'complete',
    dynamic ? '存在未执行的覆盖/继承/钩子' : '已读取当前静态配置；打包器版本行为需以产物复核',
  );
  let name: string | undefined;
  if (builder?.kind === 'electron-builder' && !dynamic) {
    const inferred = builderPackageName(pkg, config);
    if (inferred && !inferred.includes('${')) name = inferred;
  }
  // Forge can read staged application metadata and sanitize it; only an explicit unchanged name is conclusive.
  if (
    builder?.kind === 'forge' &&
    typeof forgeOptions.name === 'string' &&
    /^[a-z0-9][a-z0-9+.-]+$/.test(forgeOptions.name)
  )
    name = forgeOptions.name;
  if (!name) {
    add(
      'packaging-name',
      'info',
      '无法静态推导最终 Package',
      [file, `appId=${String(config.appId ?? '未声明')}`],
      SOURCES.builder,
      'appId/productName 不等于最终 Package；动态配置、继承或打包后元数据需要检查最终 DEB。',
    );
    mark('packaging-name', 'unknown', '最终 Package 不确定');
  } else {
    const valid =
      profile === 'uos'
        ? /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(name)
        : profile === 'kylin'
          ? /^[a-z][a-z0-9+.-]+$/.test(name)
          : /^[a-z0-9][a-z0-9+.-]+$/.test(name);
    if (!valid)
      add(
        'packaging-name',
        'error',
        '推导出的 Package 不符合当前规范',
        [file, `Package=${name}`, `appId=${String(config.appId ?? '未声明')}`],
        profile === 'uos' ? SOURCES.uos : profile === 'kylin' ? SOURCES.kylin : SOURCES.deb,
      );
    mark('packaging-name', 'complete', `静态推导 Package=${name}；最终产物仍需 inspect`);
  }
  async function checkFile(id: string, key: string, value: unknown): Promise<void> {
    if (typeof value !== 'string' || !value || value.includes('${')) {
      add(id, 'warning', `${key} 不是可确定的文件路径`, [file, String(value)]);
      return;
    }
    const resolved = path.resolve(context.cwd, value);
    try {
      const root = await realpath(context.cwd);
      const actual = await realpath(resolved);
      if (!actual.startsWith(`${root}${path.sep}`)) {
        add(id, 'info', `${key} 指向工程外，未读取`, [file, value]);
        return;
      }
      if (!(await stat(actual)).isFile()) throw new Error('不是普通文件');
    } catch {
      add(id, 'warning', `${key} 配置文件不存在或不是普通文件`, [file, value]);
    }
  }
  const scripts =
    builder?.kind === 'electron-builder'
      ? Object.fromEntries(
          ['afterInstall', 'afterRemove']
            .filter((k) => deb[k] !== undefined || linux[k] !== undefined)
            .map((k) => [k, deb[k] ?? linux[k]]),
        )
      : isRecord(forgeOptions.scripts)
        ? forgeOptions.scripts
        : {};
  if (builder.kind === 'electron-builder') {
    const fpm = deb.fpm ?? linux.fpm;
    if (Array.isArray(fpm))
      for (let i = 0; i < fpm.length; i++) {
        const arg = fpm[i];
        if (typeof arg !== 'string') continue;
        const match = /^(--(?:before-install|after-install|before-remove|after-remove|after-upgrade))(?:=(.*))?$/.exec(
          arg,
        );
        if (match) scripts[`fpm.${match[1]}`] = match[2] ?? fpm[++i];
      }
  }
  for (const [key, value] of Object.entries(scripts)) {
    await checkFile('packaging-scripts', key, value);
    add(
      'packaging-scripts',
      profile === 'uos' ? 'warning' : 'info',
      `显式维护脚本 ${key}（未执行）`,
      [file, String(value)],
      profile === 'uos' ? `${SOURCES.uos}; ${SOURCES.security}` : SOURCES.builder,
      profile === 'uos'
        ? '审核页四类脚本禁令与打包页有限操作许可冲突，需渠道确认；不能断言厂商拒绝。'
        : '仅检查配置入口和文件是否存在，不做脚本安全证明。',
    );
  }
  mark('packaging-scripts', 'unknown', '检查显式入口；打包器可能生成默认维护脚本，需 inspect 最终包');
  const desktop = builder?.kind === 'electron-builder' ? (deb.desktop ?? linux.desktop) : forgeOptions.desktopTemplate;
  if (desktop === undefined) {
    add('packaging-desktop', 'info', '未显式声明 desktop；打包器可能生成字段', [file]);
    mark('packaging-desktop', 'unknown', '不能据工程未声明判断最终包缺字段');
  } else if (builder?.kind === 'forge') {
    await checkFile('packaging-desktop', 'desktopTemplate', desktop);
    mark('packaging-desktop', 'unknown', '未执行模板；最终 desktop 需 inspect');
  } else {
    if (!isRecord(desktop))
      add('packaging-desktop', 'warning', 'desktop 配置应为对象', [file, JSON.stringify(desktop)]);
    else {
      if (desktop.entry !== undefined && !isRecord(desktop.entry))
        add('packaging-desktop', 'warning', 'desktop.entry 应为字段对象', [file, JSON.stringify(desktop.entry)]);
      const entries = isRecord(desktop.entry) ? desktop.entry : desktop;
      for (const [key, value] of Object.entries(entries))
        if (['Name', 'Exec', 'Icon', 'Type', 'Terminal', 'StartupNotify'].includes(key)) {
          if (typeof value !== 'string' || !value.trim())
            add('packaging-desktop', 'warning', `desktop.${key} 应为非空字符串`, [file, JSON.stringify(value)]);
          else if (key === 'Type' && value !== 'Application')
            add('packaging-desktop', 'warning', '显式 desktop.Type 不是 Application', [file, value]);
          else if (key === 'Icon' && value.includes('/') && !value.startsWith('/'))
            add('packaging-desktop', 'warning', '显式 Icon 应为绝对安装路径或图标主题名', [file, value]);
          else if (['Terminal', 'StartupNotify'].includes(key) && !['true', 'false'].includes(value))
            add('packaging-desktop', 'warning', `desktop.${key} 应为 true/false 字符串`, [file, value]);
        }
    }
    mark('packaging-desktop', 'unknown', '只检查显式字段类型；路径是安装后路径，不能以工程缺文件判错');
  }
  if (
    profile === 'uos' &&
    (pkg.dependencies?.['electron-updater'] ||
      pkg.devDependencies?.['electron-updater'] ||
      config.publish ||
      linux.publish ||
      deb.publish)
  )
    add(
      'packaging-updater',
      'warning',
      'UOS 商店交付发现 updater 依赖或发布配置',
      [
        file,
        `electron-updater=${String(pkg.dependencies?.['electron-updater'] ?? pkg.devDependencies?.['electron-updater'] ?? '未声明')}`,
      ],
      SOURCES.security,
      '依赖存在不等于启用自更新；UOS 商店渠道要求使用商店分发，需人工核对实际行为。',
    );
  mark(
    'packaging-updater',
    profile === 'uos' ? 'unknown' : 'not-applicable',
    '只识别依赖/发布配置；未审计运行时自更新',
  );
  const explicit = [linux.executableArgs, deb.executableArgs, desktop];
  if (explicit.some((v) => /--(?:no-sandbox|disable-setuid-sandbox)\b/.test(JSON.stringify(v) ?? '')))
    add(
      'packaging-sandbox',
      'warning',
      '显式启动配置含关闭 sandbox 参数',
      [file, ...explicit.map((v) => JSON.stringify(v) ?? '未声明')],
      SOURCES.sandbox,
      '未扫描任意业务源码；麒麟 MIPS 4755 示例不能套用 amd64，不建议默认关闭 sandbox。',
    );
  mark('packaging-sandbox', 'unknown', '仅显式启动配置，完整运行行为需目标机验证');
  return { packaging, findings };
}
