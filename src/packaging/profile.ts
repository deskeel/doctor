import type { Finding } from '../types.ts';

export type Target = 'uos-v20' | 'kylin-v10';
export type Channel = 'store' | 'direct' | 'enterprise';
export interface PackagingOptions {
  target?: Target;
  channel?: Channel;
}
export type CoverageStatus = 'complete' | 'not-applicable' | 'unknown' | 'incomplete';
export interface Coverage {
  ruleId: string;
  status: CoverageStatus;
  detail: string;
}
export const RULESET_VERSION = '2026-09-16.1';
export const SOURCES = {
  deb: 'https://www.debian.org/doc/debian-policy/ch-controlfields.html (§5); https://manpages.debian.org/deb.5; https://manpages.debian.org/tar.5',
  desktop: 'https://specifications.freedesktop.org/desktop-entry-spec/latest/exec-variables.html',
  uos: 'https://uosdn.uniontech.com/#document3?dirid=656ef27dbd766615b0b0300e&id=65702eaebd766615b0b0310d (§1–6)',
  security:
    'https://uosdn.uniontech.com/#document3?dirid=656ef27dbd766615b0b0300e&id=65703321bd766615b0b0311d (§3, §4.3)',
  kylin: 'https://www.kylinos.cn/upload/1/editor/20251223/1766460055548.pdf (§2–3)',
  sandbox: 'https://www.kylinos.cn/upload/1/editor/20251223/1766460381009.pdf (§2.4.5; §4 MIPS)',
  trust: 'https://www.kylinos.cn/upload/1/kycms/20250617/1934877956515139584.pdf (PDF p19)',
  builder:
    'https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/linux/FpmTarget.ts; https://github.com/electron-userland/electron-installer-debian#options',
};
export function validatePackagingOptions(options: PackagingOptions): void {
  if (options.target !== undefined && !['uos-v20', 'kylin-v10'].includes(options.target))
    throw new Error('--target 必须是 uos-v20 或 kylin-v10');
  if (options.channel !== undefined && !['store', 'direct', 'enterprise'].includes(options.channel))
    throw new Error('--channel 必须是 store、direct 或 enterprise');
  if (options.channel && !options.target) throw new Error('--channel 必须同时指定 --target');
}
export function vendorProfile(options: PackagingOptions): 'uos' | 'kylin' | null {
  if (options.target === 'uos-v20' && options.channel === 'store') return 'uos';
  if (options.target === 'kylin-v10' && options.channel) return 'kylin';
  return null;
}
export function issue(
  ruleId: string,
  severity: Finding['severity'],
  title: string,
  evidence: string[],
  source: string,
  detail = '根据可观察的静态数据检查；不代表厂商审核或运行验证。',
  fix = '修正对应字段或文件，然后重新检查最终 DEB。',
  verification: Finding['verification'] = 'local',
): Finding {
  return { ruleId, severity, title, evidence, source, detail, fix, verification };
}
