import type { BuilderConfig, PackageJson } from '../types.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** electron-builder 的 linux.target 项，可能是字符串或 { target, arch } 对象。 */
export interface LinuxTargetEntry {
  target: string;
  arch: string[];
}

/** 归一化 electron-builder 的 linux.target，target 名转小写；未声明 arch 时为空数组。 */
export function builderLinuxTargets(config: Record<string, unknown>): LinuxTargetEntry[] {
  const linux = config.linux;
  if (!isRecord(linux)) return [];
  const target = linux.target;
  if (target == null) return [];
  const items = Array.isArray(target) ? target : [target];
  const entries: LinuxTargetEntry[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      entries.push({ target: item.toLowerCase(), arch: [] });
    } else if (isRecord(item) && typeof item.target === 'string') {
      const arch = item.arch == null ? [] : Array.isArray(item.arch) ? item.arch : [item.arch];
      entries.push({ target: item.target.toLowerCase(), arch: arch.filter((a): a is string => typeof a === 'string') });
    }
  }
  return entries;
}

export function builderHasDebTarget(config: Record<string, unknown>): boolean {
  return builderLinuxTargets(config).some((entry) => entry.target === 'deb');
}

/** Forge makers 中第一个 maker-deb 的配置对象；没有 maker-deb 时返回 null。 */
export function forgeDebMaker(config: Record<string, unknown>): Record<string, unknown> | null {
  const makers = config.makers;
  if (!Array.isArray(makers)) return null;
  for (const maker of makers) {
    if (isRecord(maker) && typeof maker.name === 'string' && maker.name.includes('maker-deb')) {
      return isRecord(maker.config) ? maker.config : {};
    }
  }
  return null;
}

/** package.json 的 author 字段是否带有邮箱（字符串形式含 <...@...>，或对象形式有 email）。 */
export function authorHasEmail(packageJson: PackageJson): boolean {
  const author = packageJson.author;
  if (typeof author === 'string') return /<[^<>@\s]+@[^<>@\s]+>/.test(author);
  if (isRecord(author)) return typeof author.email === 'string' && author.email.includes('@');
  return false;
}

/** 当前配置是否会产出 DEB：electron-builder linux.target 含 deb，或 Forge 配了 maker-deb。 */
export function producesDeb(builder: BuilderConfig): boolean {
  if (!builder.config) return false;
  return builder.kind === 'electron-builder'
    ? builderHasDebTarget(builder.config)
    : forgeDebMaker(builder.config) !== null;
}
