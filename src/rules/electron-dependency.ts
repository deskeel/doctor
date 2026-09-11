import type { Finding, Rule } from '../types.ts';

const UNPINNED = new Set(['', '*', 'latest', 'x']);

export const electronDependency: Rule = {
  id: 'electron-dependency',
  title: 'electron 声明在 devDependencies 且版本明确',
  description: '检查 electron 是否作为开发依赖声明，以及版本是否可复现。',
  source:
    'Electron 官方安装指南要求把 electron 放在 devDependencies：https://www.electronjs.org/docs/latest/tutorial/installation',
  check(context) {
    if (!context.packageJson) return [];
    const findings: Finding[] = [];
    const electron = context.electron;

    if (!electron) {
      findings.push({
        ruleId: 'electron-dependency',
        severity: 'error',
        verification: 'local',
        title: 'package.json 中没有声明 electron',
        detail: '无法确定运行时版本，也就无法判断它对目标系统 glibc 和系统库的要求。',
        fix: '运行 `npm install --save-dev electron@<版本>`，把 electron 加入 devDependencies。',
      });
      return findings;
    }

    if (electron.field === 'dependencies') {
      findings.push({
        ruleId: 'electron-dependency',
        severity: 'warning',
        verification: 'local',
        title: 'electron 声明在 dependencies 而不是 devDependencies',
        detail: '打包器会把 dependencies 里的模块复制进安装包，导致 DEB 体积异常并可能重复携带 Electron 二进制。',
        fix: '把 electron 移到 devDependencies。',
      });
    }

    if (UNPINNED.has(electron.spec.trim().toLowerCase())) {
      findings.push({
        ruleId: 'electron-dependency',
        severity: 'warning',
        verification: 'local',
        title: `electron 版本 "${electron.spec}" 不明确`,
        detail: '每次安装可能拿到不同的 Electron 大版本，对国产系统的兼容结论也会随之变化。',
        fix: '使用明确的版本范围，例如 "^31.0.0"，并提交锁文件。',
      });
    }

    return findings;
  },
};
