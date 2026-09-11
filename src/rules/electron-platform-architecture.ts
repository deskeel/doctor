import { builderLinuxTargets } from '../builder/config.ts';
import { ELECTRON_LINUX_ARTIFACTS, type LinuxArch, normalizeArch } from '../data/electron-releases.ts';
import { resolveElectron } from '../electron-version.ts';
import type { Finding, Rule } from '../types.ts';

const RULE_ID = 'electron-platform-architecture';
const BREAKING_CHANGES = 'https://www.electronjs.org/docs/latest/breaking-changes';

export const electronPlatformArchitecture: Rule = {
  id: RULE_ID,
  title: '声明的 Linux 目标架构有 Electron 官方产物',
  description:
    '读取 electron-builder linux.target 里声明的架构，对照 Electron 官方 Linux 产物表：x86_64 与 aarch64 有官方产物；armv7l 在 44 起、ia32 在 19 起停发；国产指令集没有官方产物。',
  source: `Electron 支持平台列表：https://www.electronjs.org/docs/latest/tutorial/support#supported-platforms；armv7l 于 44.0、Linux ia32 于 19.0 停发：${BREAKING_CHANGES}`,
  async check(context) {
    const { builder } = context;
    if (!context.packageJson || !builder?.config || builder.kind !== 'electron-builder') return [];

    const declared = new Map<LinuxArch, string>();
    const unknown = new Set<string>();
    for (const entry of builderLinuxTargets(builder.config)) {
      for (const raw of entry.arch) {
        const arch = normalizeArch(raw);
        if (arch) declared.set(arch, raw);
        else unknown.add(raw);
      }
    }
    if (declared.size === 0 && unknown.size === 0) return [];

    const electron = await resolveElectron(context);
    const findings: Finding[] = [];
    const evidence = [`${builder.file} 的 linux.target 声明了架构：${[...declared.values(), ...unknown].join('、')}`];

    for (const [arch, raw] of declared) {
      const artifact = ELECTRON_LINUX_ARTIFACTS[arch];
      const label = raw === arch ? arch : `${raw}（${arch}）`;

      if (!artifact.official) {
        findings.push({
          ruleId: RULE_ID,
          severity: 'error',
          verification: 'local',
          title: `目标架构 ${label} 没有 Electron 官方产物`,
          detail:
            'Electron 官方只发布 x64、arm64（以及早期的 armv7l、ia32）Linux 产物。这个架构需要自行或由第三方从源码构建 Electron，doctor 不对定制运行时做判断。',
          fix: '如果目标是 UOS / 麒麟的 x86_64 版本，把 arch 改为 x64；如果确实要交付该架构，需要准备对应的 Electron 定制构建。',
          evidence,
        });
        continue;
      }

      if (artifact.lastMajor !== undefined) {
        const stillPublished = electron !== null && electron.major <= artifact.lastMajor;
        findings.push({
          ruleId: RULE_ID,
          severity: stillPublished ? 'info' : 'warning',
          verification: 'local',
          title: stillPublished
            ? `目标架构 ${label} 的官方产物在 Electron ${artifact.lastMajor + 1} 起停发，当前 Electron ${electron.major} 仍有产物`
            : `目标架构 ${label} 自 Electron ${artifact.lastMajor + 1} 起没有官方产物`,
          detail: `Electron ${artifact.lastMajor + 1} 的 Breaking Changes 宣布不再发布 linux-${raw === 'armhf' ? 'armv7l' : arch === 'ia32' ? 'ia32' : arch} 产物。统信 UOS 与银河麒麟的桌面版都是 64 位系统。`,
          fix: '从 linux.target 的 arch 中移除该架构，只保留 x64（以及确有需求的 arm64）。',
          evidence,
        });
        continue;
      }

      if (arch === 'aarch64') {
        findings.push({
          ruleId: RULE_ID,
          severity: 'info',
          verification: 'local',
          title: `目标架构 ${label} 有 Electron 官方产物，但 doctor 当前只对 x86_64 做判定`,
          detail: '飞腾、鲲鹏等 ARM64 平台的 UOS / 麒麟尚无真机证据，doctor 只识别 arm64 目标，不做规则判断。',
          fix: '无需修改。如有 ARM64 交付需求，欢迎在 GitHub issue 中反馈使用场景，以便补充真机证据。',
          evidence,
        });
      }
    }

    for (const raw of unknown) {
      findings.push({
        ruleId: RULE_ID,
        severity: 'info',
        verification: 'local',
        title: `无法识别的目标架构 "${raw}"`,
        detail: 'electron-builder 支持的 Linux arch 为 x64、arm64、armv7l、ia32。',
        fix: '检查 linux.target 里 arch 的拼写。',
        evidence,
      });
    }

    return findings;
  },
};
