import { builderLinuxTargets, forgeDebMaker } from '../builder/config.ts';
import type { BuilderConfig, Finding, Rule } from '../types.ts';

function cannotInspect(builder: BuilderConfig): Finding {
  return {
    ruleId: 'linux-deb-target',
    severity: 'info',
    verification: 'local',
    title: `${builder.kind} 配置 ${builder.file} 无法静态读取${builder.error ? `：${builder.error}` : ''}`,
    detail: 'doctor 只读取 JSON/YAML 或 package.json 内的配置，不执行 JS/TS 配置文件。',
    fix: '请自行确认 linux 目标包含 deb；或把配置改为 package.json、YAML 或 JSON 形式以便自动检查。',
  };
}

export const linuxDebTarget: Rule = {
  id: 'linux-deb-target',
  title: '打包配置包含 Linux DEB 目标',
  description: '检查 electron-builder 的 linux.target 是否包含 deb，或 Electron Forge 是否配置了 maker-deb。',
  source:
    'electron-builder 未配置 linux.target 时默认只产出 AppImage：https://www.electron.build/linux；Forge DEB 需要 @electron-forge/maker-deb：https://www.electronforge.io/config/makers/deb',
  check(context) {
    if (!context.packageJson) return [];
    const { builder } = context;

    if (!builder) {
      return [
        {
          ruleId: 'linux-deb-target',
          severity: 'warning',
          verification: 'local',
          title: '未检测到 electron-builder 或 Electron Forge 配置',
          detail: '统信 UOS 和银河麒麟的交付格式是 DEB，需要打包器生成。',
          fix: '添加 electron-builder 配置并设置 linux.target 为 ["deb"]，或使用 Electron Forge 的 @electron-forge/maker-deb。',
        },
      ];
    }

    if (!builder.config) return [cannotInspect(builder)];

    if (builder.kind === 'electron-builder') {
      const targets = builderLinuxTargets(builder.config).map((entry) => entry.target);
      if (targets.includes('deb')) return [];
      return [
        {
          ruleId: 'linux-deb-target',
          severity: 'error',
          verification: 'local',
          title:
            targets.length === 0
              ? `${builder.file} 未配置 linux.target，默认只会产出 AppImage`
              : `${builder.file} 的 linux.target 为 ${targets.join('、')}，不包含 deb`,
          detail: 'UOS 和麒麟通过 dpkg/apt 安装和卸载应用，AppImage 无法进入系统包管理与桌面集成。',
          fix: '在 linux.target 中加入 "deb"，例如 "linux": { "target": ["deb"] }。',
        },
      ];
    }

    if (forgeDebMaker(builder.config)) return [];
    return [
      {
        ruleId: 'linux-deb-target',
        severity: 'error',
        verification: 'local',
        title: `${builder.file} 的 makers 中没有 @electron-forge/maker-deb`,
        detail: 'UOS 和麒麟通过 dpkg/apt 安装和卸载应用，需要 DEB 格式。',
        fix: '安装 @electron-forge/maker-deb 并加入 makers 配置。',
      },
    ];
  },
};
