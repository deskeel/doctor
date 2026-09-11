/**
 * Electron 稳定版发布表。随包发布，离线使用。
 *
 * 数据来源：https://endoflife.date/api/electron.json 与 https://releases.electronjs.org/，
 * 于 dataAsOf 当天核对。Electron 官方策略：同时维护最新的三个大版本，
 * 见 https://www.electronjs.org/docs/latest/tutorial/electron-timelines。
 *
 * 更新方法：核对上述来源后改写 cycles 与 dataAsOf。列表只需覆盖仍在维护和最近停止维护的版本；
 * 小于列表最小值的大版本一律视为已停止维护。
 */
export interface ElectronCycle {
  major: number;
  /** x.0.0 稳定版发布日期。 */
  releaseDate: string;
  /** 停止维护日期（当天起不再发布修复）。 */
  eol: string;
  /** dataAsOf 当天的最新补丁版本。 */
  latest: string;
}

export interface ElectronReleaseData {
  dataAsOf: string;
  source: string;
  cycles: readonly ElectronCycle[];
}

export const ELECTRON_RELEASES: ElectronReleaseData = {
  dataAsOf: '2026-09-10',
  source: 'https://endoflife.date/electron',
  cycles: [
    { major: 44, releaseDate: '2026-08-25', eol: '2027-03-02', latest: '44.3.0' },
    { major: 43, releaseDate: '2026-06-30', eol: '2027-01-05', latest: '43.7.0' },
    { major: 42, releaseDate: '2026-05-05', eol: '2026-10-20', latest: '42.11.3' },
    { major: 41, releaseDate: '2026-03-10', eol: '2026-08-25', latest: '41.10.7' },
    { major: 40, releaseDate: '2026-01-13', eol: '2026-06-30', latest: '40.10.6' },
  ],
};

/** 发布表超过这个天数未更新时，结果里附“可能过期”提示。 */
export const ELECTRON_DATA_STALE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(from: string, to: Date): number {
  return Math.floor((to.getTime() - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function isElectronDataStale(data: ElectronReleaseData, now: Date): boolean {
  return daysBetween(data.dataAsOf, now) > ELECTRON_DATA_STALE_DAYS;
}

/** doctor 报告统一使用的架构规范名。 */
export type LinuxArch =
  | 'x86_64'
  | 'aarch64'
  | 'armv7l'
  | 'ia32'
  | 'loongarch64'
  | 'mips64el'
  | 'sw_64'
  | 'riscv64'
  | 'ppc64le'
  | 's390x';

/**
 * Electron 官方 Linux 产物覆盖情况。
 * armv7l 与 ia32 的停发版本来自 Electron Breaking Changes（44.0 与 19.0 两节），
 * 见 https://www.electronjs.org/docs/latest/breaking-changes。
 */
export const ELECTRON_LINUX_ARTIFACTS: Record<LinuxArch, { official: boolean; lastMajor?: number }> = {
  x86_64: { official: true },
  aarch64: { official: true },
  armv7l: { official: true, lastMajor: 43 },
  ia32: { official: true, lastMajor: 18 },
  loongarch64: { official: false },
  mips64el: { official: false },
  sw_64: { official: false },
  riscv64: { official: false },
  ppc64le: { official: false },
  s390x: { official: false },
};

const ARCH_ALIASES: Record<string, LinuxArch> = {
  x64: 'x86_64',
  x86_64: 'x86_64',
  'x86-64': 'x86_64',
  amd64: 'x86_64',
  arm64: 'aarch64',
  aarch64: 'aarch64',
  armv7l: 'armv7l',
  armhf: 'armv7l',
  arm: 'armv7l',
  ia32: 'ia32',
  x86: 'ia32',
  i386: 'ia32',
  i686: 'ia32',
  loong64: 'loongarch64',
  loongarch64: 'loongarch64',
  mips64el: 'mips64el',
  sw_64: 'sw_64',
  sw64: 'sw_64',
  riscv64: 'riscv64',
  ppc64le: 'ppc64le',
  s390x: 's390x',
};

/** 把打包配置里的架构名归一为规范名；无法识别时返回 null。 */
export function normalizeArch(name: string): LinuxArch | null {
  return ARCH_ALIASES[name.trim().toLowerCase()] ?? null;
}
