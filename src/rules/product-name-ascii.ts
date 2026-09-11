import { forgeDebMaker, isRecord, producesDeb } from '../builder/config.ts';
import type { Finding, PackageJson, Rule } from '../types.ts';

const RULE_ID = 'product-name-ascii';
const NON_ASCII = /[^\x20-\x7e]/;
/** Debian Policy 5.6.7：小写字母、数字、+ - .，至少两个字符，以字母或数字开头。 */
const DEB_PACKAGE_NAME = /^[a-z0-9][a-z0-9+.-]+$/;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** electron-builder 用 sanitize-filename 处理 productName：去掉文件名非法字符与控制字符，保留 Unicode。 */
function sanitizeFileName(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 与 sanitize-filename 的处理范围一致
  return name.replace(/[/?<>\\:*|"\x00-\x1f\x80-\x9f]/g, '').replace(/[. ]+$/, '');
}

/** fpm 生成 DEB 前会把包名转小写，并把下划线和空格换成连字符。 */
function fpmNormalize(name: string): string {
  return name.toLowerCase().replace(/[_ ]/g, '-');
}

function finding(severity: Finding['severity'], title: string, detail: string, fix: string): Finding {
  return { ruleId: RULE_ID, severity, verification: 'local', title, detail, fix };
}

function nonAsciiExecutable(source: string, value: string, fix: string): Finding {
  return finding(
    'warning',
    `${source} "${value}" 含非 ASCII 字符，将成为可执行文件名或安装目录名`,
    'Linux 可执行文件、安装目录、.desktop 文件名和图标文件名都会沿用这个名字。非 ASCII 路径在构建机 locale、桌面环境和维护脚本中的表现无法保证一致。',
    fix,
  );
}

function checkElectronBuilder(packageJson: PackageJson, config: Record<string, unknown>, file: string): Finding[] {
  const findings: Finding[] = [];
  const name = str(packageJson.name) ?? '';
  const productName = str(config.productName) ?? str(packageJson.productName) ?? name;
  const linux = isRecord(config.linux) ? config.linux : {};
  const deb = isRecord(config.deb) ? config.deb : {};

  const rawPackageName = str(deb.packageName) ?? (name.startsWith('@') ? sanitizeFileName(productName) : name);
  const packageName = fpmNormalize(rawPackageName);
  if (rawPackageName !== '' && !DEB_PACKAGE_NAME.test(packageName)) {
    const origin = str(deb.packageName)
      ? 'deb.packageName'
      : name.startsWith('@')
        ? 'productName（name 带 scope）'
        : 'name';
    findings.push(
      finding(
        'error',
        `DEB 包名 "${packageName}"（来自 ${origin}）含 dpkg 不接受的字符`,
        NON_ASCII.test(packageName)
          ? 'Debian 包名只允许小写字母、数字、+、- 和 .，dpkg-deb 会拒绝生成含非 ASCII 字符的包。'
          : 'Debian 包名只允许小写字母、数字、+、- 和 .，至少两个字符，且以字母或数字开头。',
        `在 ${file} 中设置 deb.packageName 为符合规则的名字，例如 "${packageName.replace(/[^a-z0-9+.-]/g, '').replace(/^[^a-z0-9]+/, '') || 'my-app'}"。`,
      ),
    );
  }

  const executableName = str(linux.executableName) ?? str(config.executableName);
  if (executableName) {
    if (NON_ASCII.test(executableName)) {
      findings.push(
        nonAsciiExecutable(
          'executableName',
          executableName,
          '把 executableName 改为纯 ASCII，例如小写英文加连字符；显示名称仍可通过 productName 使用中文。',
        ),
      );
    }
  } else if (NON_ASCII.test(productName)) {
    findings.push(
      nonAsciiExecutable(
        'productName',
        productName,
        `在 ${file} 中设置 linux.executableName 为纯 ASCII 名字；productName 仍可保留中文用于窗口标题和启动器显示。`,
      ),
    );
  }

  return findings;
}

function checkForge(
  packageJson: PackageJson,
  config: Record<string, unknown>,
  maker: Record<string, unknown>,
): Finding[] {
  const findings: Finding[] = [];
  const packagerConfig = isRecord(config.packagerConfig) ? config.packagerConfig : {};
  const options = isRecord(maker.options) ? maker.options : {};
  const executableName =
    str(packagerConfig.executableName) ??
    str(packagerConfig.name) ??
    str(packageJson.productName) ??
    str(packageJson.name) ??
    '';
  if (NON_ASCII.test(executableName)) {
    const origin = str(packagerConfig.executableName)
      ? 'packagerConfig.executableName'
      : str(packagerConfig.name)
        ? 'packagerConfig.name'
        : 'productName';
    findings.push(
      nonAsciiExecutable(
        origin,
        executableName,
        '在 packagerConfig.executableName 中设置纯 ASCII 名字；productName 仍可保留中文用于显示。',
      ),
    );
  }
  const bin = str(options.bin);
  if (bin && NON_ASCII.test(bin)) {
    findings.push(
      nonAsciiExecutable('maker-deb options.bin', bin, '把 options.bin 改为与可执行文件一致的纯 ASCII 名字。'),
    );
  }
  return findings;
}

export const productNameAscii: Rule = {
  id: RULE_ID,
  title: 'DEB 包名与可执行文件名只含 ASCII 字符',
  description: '检查打包配置推导出的 Debian 包名是否符合 dpkg 规则，以及可执行文件名、安装目录名是否含非 ASCII 字符。',
  source:
    'Debian Policy 5.6.7 包名字符集：https://www.debian.org/doc/debian-policy/ch-controlfields.html#package；electron-builder 包名取自 deb.packageName、name 或（scope 包）productName，可执行文件名取自 executableName 或 productName：https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/appInfo.ts；fpm 只自动处理大写、下划线和空格：https://github.com/jordansissel/fpm/blob/main/lib/fpm/package/deb.rb；Electron Packager 的 executableName 默认取 name（即 productName）：https://electron.github.io/packager/main/interfaces/Options.html',
  check(context) {
    const { packageJson, builder } = context;
    if (!packageJson || !builder?.config || !producesDeb(builder)) return [];
    if (builder.kind === 'electron-builder') return checkElectronBuilder(packageJson, builder.config, builder.file);
    const maker = forgeDebMaker(builder.config);
    return maker ? checkForge(packageJson, builder.config, maker) : [];
  },
};
