import type { Rule } from '../types.ts';

export const packageJson: Rule = {
  id: 'package-json',
  title: '工程根目录包含可解析的 package.json',
  description: '确认目标目录是一个 Node.js 工程，后续规则都依赖它。',
  source: 'npm package.json 规范：https://docs.npmjs.com/cli/configuring-npm/package-json',
  check(context) {
    if (context.packageJson) return [];
    return [
      {
        ruleId: 'package-json',
        severity: 'error',
        verification: 'local',
        title: context.packageJsonError ?? '未找到 package.json',
        detail: '没有 package.json 就无法确定 Electron 版本、依赖和打包配置。',
        fix: '在 Electron 工程根目录运行 doctor，或用位置参数指定工程目录。',
      },
    ];
  },
};
