import { access } from 'node:fs/promises';
import path from 'node:path';
import { authorHasEmail, forgeDebMaker, isRecord, producesDeb } from '../builder/config.ts';
import type { Finding, PackageJson, ProjectContext, Rule } from '../types.ts';

const RULE_ID = 'deb-metadata';

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function finding(severity: Finding['severity'], title: string, detail: string, fix: string): Finding {
  return { ruleId: RULE_ID, severity, verification: 'local', title, detail, fix };
}

/** electron-builder 默认从 <buildResources>/icon.png 或 <buildResources>/icons/ 取图标。 */
async function builderDefaultIconExists(cwd: string, config: Record<string, unknown>): Promise<boolean> {
  const directories = isRecord(config.directories) ? config.directories : {};
  const buildResources = str(directories.buildResources) ?? 'build';
  const base = path.join(cwd, buildResources);
  return (await exists(path.join(base, 'icon.png'))) || (await exists(path.join(base, 'icons')));
}

async function checkElectronBuilder(
  context: ProjectContext,
  packageJson: PackageJson,
  config: Record<string, unknown>,
  file: string,
): Promise<Finding[]> {
  const linux = isRecord(config.linux) ? config.linux : {};
  const deb = isRecord(config.deb) ? config.deb : {};
  const findings: Finding[] = [];

  if (!str(deb.maintainer) && !str(linux.maintainer) && !authorHasEmail(packageJson)) {
    findings.push(
      finding(
        'error',
        `${file} 未声明 maintainer，package.json 的 author 也没有邮箱`,
        'electron-builder 生成 DEB 的 Maintainer 字段时会回退到 package.json 的 author 邮箱，两者都没有时构建直接失败。',
        '在 linux.maintainer 写 "名字 <邮箱>"，或在 package.json 的 author 中填写 email。',
      ),
    );
  }

  if (!str(linux.category)) {
    findings.push(
      finding(
        'warning',
        `${file} 未声明 linux.category`,
        '.desktop 文件缺少 Categories 时，应用在 UOS / 麒麟的启动器里可能落入“其他”分类或不出现在分类菜单中。',
        '按 freedesktop 菜单规范设置 linux.category，例如 "Utility"、"Office"、"Development"。',
      ),
    );
  }

  const iconDeclared = str(linux.icon) ?? str(deb.icon) ?? str(config.icon);
  if (!iconDeclared && !(await builderDefaultIconExists(context.cwd, config))) {
    findings.push(
      finding(
        'warning',
        `${file} 未声明图标，且 build/icon.png 或 build/icons/ 不存在`,
        'electron-builder 会退回使用 Electron 默认图标，安装后桌面和启动器显示的是 Electron 标志而不是应用图标。',
        '放置 build/icon.png（至少 512×512）或 build/icons/ 多尺寸目录，或用 linux.icon 指向图标文件。',
      ),
    );
  }

  if (!str(linux.executableName) && !str(config.executableName) && !str(config.productName) && !str(packageJson.name)) {
    findings.push(
      finding(
        'warning',
        `${file} 无法确定可执行文件名`,
        'executableName、productName 和 package.json 的 name 都为空时，DEB 内的二进制与 .desktop 的 Exec 无法命名。',
        '设置 productName 或 executableName。',
      ),
    );
  }

  return findings;
}

function checkForge(packageJson: PackageJson, maker: Record<string, unknown>, file: string): Finding[] {
  const options = isRecord(maker.options) ? maker.options : {};
  const findings: Finding[] = [];

  if (!str(options.maintainer) && !authorHasEmail(packageJson)) {
    findings.push(
      finding(
        'warning',
        `${file} 的 maker-deb 未声明 options.maintainer，package.json 的 author 也没有邮箱`,
        'maker-deb 用 package.json 的 author 名字和邮箱生成 Maintainer 字段，缺失时 control 文件的 Maintainer 不完整，dpkg 与 lintian 会报告问题。',
        '在 maker-deb 的 config.options.maintainer 写 "名字 <邮箱>"，或在 package.json 的 author 中填写 email。',
      ),
    );
  }

  if (!str(options.icon)) {
    findings.push(
      finding(
        'warning',
        `${file} 的 maker-deb 未声明 options.icon`,
        'maker-deb 会退回使用 Electron 默认图标，安装后桌面和启动器显示的是 Electron 标志而不是应用图标。',
        '在 maker-deb 的 config.options.icon 指向 PNG 图标文件。',
      ),
    );
  }

  const categories = options.categories;
  if (!Array.isArray(categories) || categories.length === 0) {
    findings.push(
      finding(
        'info',
        `${file} 的 maker-deb 未声明 options.categories，将使用默认值 GNOME、GTK、Utility`,
        '默认分类能让应用出现在启动器中，但与应用实际用途可能不符。',
        '按 freedesktop 菜单规范设置 options.categories，例如 ["Office"]。',
      ),
    );
  }

  return findings;
}

export const debMetadata: Rule = {
  id: RULE_ID,
  title: 'DEB 元数据齐全：maintainer、图标、desktop 分类、可执行文件名',
  description: '在打包配置会产出 DEB 的前提下，检查 Maintainer、图标、桌面分类和可执行文件名是否可以确定。',
  source:
    'electron-builder Linux 选项（maintainer 默认取 author，icon 默认取 build/icon.png 或 build/icons）：https://www.electron.build/linux；maker-deb / electron-installer-debian 选项：https://github.com/electron-userland/electron-installer-debian#options；Debian Policy 5.6.2 Maintainer：https://www.debian.org/doc/debian-policy/ch-controlfields.html#maintainer',
  async check(context) {
    const { packageJson, builder } = context;
    if (!packageJson || !builder?.config || !producesDeb(builder)) return [];
    if (builder.kind === 'electron-builder') {
      return checkElectronBuilder(context, packageJson, builder.config, builder.file);
    }
    const maker = forgeDebMaker(builder.config);
    return maker ? checkForge(packageJson, maker, builder.file) : [];
  },
};
