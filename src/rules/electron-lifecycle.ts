import {
  daysBetween,
  ELECTRON_DATA_STALE_DAYS,
  ELECTRON_RELEASES,
  type ElectronReleaseData,
  isElectronDataStale,
} from '../data/electron-releases.ts';
import { resolveElectron } from '../electron-version.ts';
import type { Finding, Rule } from '../types.ts';

const RULE_ID = 'electron-lifecycle';

export function createElectronLifecycle(data: ElectronReleaseData = ELECTRON_RELEASES): Rule {
  return {
    id: RULE_ID,
    title: 'Electron 大版本在官方支持窗口内',
    description: '对照随包发布的 Electron 发布表，检查工程使用的 Electron 大版本是否仍在维护。',
    source: `Electron 发布时间线与支持策略：https://www.electronjs.org/docs/latest/tutorial/electron-timelines；发布表数据截至 ${data.dataAsOf}，来源 ${data.source}`,
    async check(context) {
      if (!context.packageJson || !context.electron) return [];
      const findings: Finding[] = [];
      const resolved = await resolveElectron(context);
      const now = context.now;
      const evidence = [`Electron 发布表数据截至 ${data.dataAsOf}`];

      if (resolved) {
        const label =
          resolved.origin === 'installed'
            ? `已安装的 Electron ${resolved.version}`
            : `声明的 Electron ${resolved.version}`;
        const cycle = data.cycles.find((entry) => entry.major === resolved.major);
        const newest = data.cycles.reduce((max, entry) => Math.max(max, entry.major), 0);
        const oldest = data.cycles.reduce((min, entry) => Math.min(min, entry.major), Number.POSITIVE_INFINITY);

        if (cycle) {
          if (daysBetween(cycle.eol, now) >= 0) {
            findings.push({
              ruleId: RULE_ID,
              severity: 'warning',
              verification: 'local',
              title: `${label} 已于 ${cycle.eol} 停止维护`,
              detail: `Electron 只维护最新的三个大版本。停止维护后不再有安全修复和 Chromium 更新，${cycle.major} 系列最后一个版本为 ${cycle.latest}。`,
              fix: `升级到仍在维护的 Electron 大版本（截至 ${data.dataAsOf} 为 ${data.cycles
                .filter((entry) => daysBetween(entry.eol, now) < 0)
                .map((entry) => entry.major)
                .sort((a, b) => a - b)
                .join('、')}）。`,
              evidence,
            });
          }
        } else if (resolved.major < oldest) {
          findings.push({
            ruleId: RULE_ID,
            severity: 'warning',
            verification: 'local',
            title: `${label} 已停止维护`,
            detail: `发布表（截至 ${data.dataAsOf}）覆盖 Electron ${oldest} 起的版本，更早的大版本都已停止维护，不再有安全修复和 Chromium 更新。`,
            fix: `升级到仍在维护的 Electron 大版本（截至 ${data.dataAsOf} 为 ${data.cycles
              .filter((entry) => daysBetween(entry.eol, now) < 0)
              .map((entry) => entry.major)
              .sort((a, b) => a - b)
              .join('、')}）。`,
            evidence,
          });
        } else if (resolved.major > newest) {
          findings.push({
            ruleId: RULE_ID,
            severity: 'info',
            verification: 'local',
            title: `${label} 比 doctor 内置的发布表更新，无法判断支持窗口`,
            detail: `发布表截至 ${data.dataAsOf}，最高覆盖到 Electron ${newest}。`,
            fix: '升级 @deskeel-org/doctor 到最新版本以获得更新的发布表。',
            evidence,
          });
        }
      }

      if (isElectronDataStale(data, now)) {
        findings.push({
          ruleId: RULE_ID,
          severity: 'info',
          verification: 'local',
          title: `Electron 发布窗口信息可能过期：内置发布表截至 ${data.dataAsOf}，已超过 ${ELECTRON_DATA_STALE_DAYS} 天`,
          detail: '新的 Electron 大版本大约每两个月发布一次，本规则的支持窗口结论以内置数据为准。',
          fix: '升级 @deskeel-org/doctor 到最新版本，或到 https://endoflife.date/electron 核对当前支持窗口。',
          evidence,
        });
      }

      return findings;
    },
  };
}

export const electronLifecycle: Rule = createElectronLifecycle();
