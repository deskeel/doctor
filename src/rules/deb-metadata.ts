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

function buildResourcesDir(config: Record<string, unknown>): string {
  const directories = isRecord(config.directories) ? config.directories : {};
  return str(directories.buildResources) ?? 'build';
}

/** electron-builder 未声明图标时回退到 <buildResources>/icons/，再退到 Electron 默认图标。 */
async function builderDefaultIconExists(cwd: string, config: Record<string, unknown>): Promise<boolean> {
  const base = path.join(cwd, buildResourcesDir(config));
  return (await exists(path.join(base, 'icons'))) || (await exists(path.join(base, 'icon.png')));
}

/** electron-builder 的 computePackageUrl：homepage，否则 repository 的 url。 */
function projectUrl(packageJson: PackageJson): string | undefined {
  if (str(packageJson.homepage)) return packageJson.homepage as string;
  const repository = packageJson.repository;
  if (typeof repository === 'string') return str(repository);
  if (isRecord(repository)) return str(repository.url);
  return undefined;
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

  if (!projectUrl(packageJson)) {
    findings.push(
      finding(
        'error',
        'package.json 没有 homepage，也没有可用的 repository 地址',
        'electron-builder 生成 DEB 时要求提供项目主页（Homepage 字段），homepage 与 repository 都缺失时构建直接失败。',
        '在 package.json 中填写 homepage，或填写 repository.url。',
      ),
    );
  }

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

  if (!str(linux.category) && !str(deb.category)) {
    findings.push(
      finding(
        'info',
        `${file} 未声明 linux.category，将使用默认值 Utility`,
        '默认分类能让应用出现在启动器中，但与应用实际用途可能不符。',
        '按 freedesktop 菜单规范设置 linux.category，例如 "Office"、"Development"。',
      ),
    );
  }

  const iconDeclared = str(linux.icon) ?? str(deb.icon) ?? str(config.icon);
  if (!iconDeclared && !(await builderDefaultIconExists(context.cwd, config))) {
    findings.push(
      finding(
        'warning',
        `${file} 未声明图标，且 ${buildResourcesDir(config)}/icons/ 与 ${buildResourcesDir(config)}/icon.png 都不存在`,
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
  title: 'DEB 元数据齐全：homepage、maintainer、图标、desktop 分类、可执行文件名',
  description: '在打包配置会产出 DEB 的前提下，检查 Homepage、Maintainer、图标、桌面分类和可执行文件名是否可以确定。',
  source:
    'electron-builder FpmTarget 在 homepage 或 author 邮箱缺失时抛错，LinuxTargetHelper 在 category 缺失时回退 Utility、图标缺失时回退 buildResources/icons 再回退默认图标：https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src/targets/linux；maker-deb / electron-installer-debian 选项：https://github.com/electron-userland/electron-installer-debian#options；Debian Policy 5.6.2 Maintainer：https://www.debian.org/doc/debian-policy/ch-controlfields.html#maintainer',
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
