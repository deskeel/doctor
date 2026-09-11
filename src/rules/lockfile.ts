import type { Finding, PackageManager, Rule } from '../types.ts';

function declaredPackageManager(spec: string | undefined): PackageManager | null {
  if (!spec) return null;
  const name = spec.split('@')[0];
  return name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun' ? name : null;
}

export const lockfile: Rule = {
  id: 'lockfile',
  title: '锁文件存在、唯一，并与 packageManager 字段一致',
  description: '检查依赖是否可以在构建机上被精确复现。',
  source:
    'npm、pnpm、yarn 官方文档都要求提交锁文件以获得可复现安装；packageManager 字段见 https://nodejs.org/api/packages.html#packagemanager',
  check(context) {
    if (!context.packageJson) return [];
    const findings: Finding[] = [];
    const { lockfiles } = context;

    if (lockfiles.length === 0) {
      findings.push({
        ruleId: 'lockfile',
        severity: 'error',
        verification: 'local',
        title: '没有找到锁文件',
        detail: '构建机安装到的依赖版本可能与本地不同，原生模块和 Electron 版本都可能漂移。',
        fix: '在本地运行一次安装并提交 package-lock.json、pnpm-lock.yaml 或 yarn.lock。',
      });
      return findings;
    }

    const managers = new Set(lockfiles.map((lock) => lock.packageManager));
    if (managers.size > 1) {
      findings.push({
        ruleId: 'lockfile',
        severity: 'warning',
        verification: 'local',
        title: `存在多个包管理器的锁文件：${lockfiles.map((lock) => lock.file).join('、')}`,
        detail: '构建机无法确定应该用哪个包管理器安装，不同锁文件解析出的依赖树可能不一致。',
        fix: '只保留实际使用的包管理器的锁文件，并删除其余锁文件。',
      });
    }

    const declared = declaredPackageManager(context.packageJson.packageManager);
    if (declared && !managers.has(declared)) {
      findings.push({
        ruleId: 'lockfile',
        severity: 'warning',
        verification: 'local',
        title: `packageManager 声明为 ${declared}，但锁文件来自 ${[...managers].join('、')}`,
        detail: 'Corepack 会按 packageManager 字段选择工具，与锁文件不一致时安装会失败或忽略锁文件。',
        fix: '统一 packageManager 字段和锁文件，二者只保留一种包管理器。',
      });
    }

    return findings;
  },
};
