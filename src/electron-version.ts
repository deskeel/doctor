import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectContext } from './types.ts';

/** 从版本范围里取第一个大版本号；latest、*、x 等无法确定时返回 null。 */
export function majorFromSpec(spec: string): number | null {
  const match = /(?:^|[^\d.])v?(\d+)(?:\.\d+)?(?:\.\d+)?/.exec(spec.trim());
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

export interface ResolvedElectron {
  major: number;
  version: string;
  origin: 'installed' | 'declared';
}

/** 优先读 node_modules/electron 里实际安装的版本，否则退回 package.json 的声明。 */
export async function resolveElectron(context: ProjectContext): Promise<ResolvedElectron | null> {
  try {
    const file = path.join(context.cwd, 'node_modules', 'electron', 'package.json');
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    const version = typeof parsed === 'object' && parsed !== null ? (parsed as { version?: unknown }).version : null;
    if (typeof version === 'string') {
      const major = majorFromSpec(version);
      if (major !== null) return { major, version, origin: 'installed' };
    }
  } catch {
    // 未安装或无法读取时退回到 package.json 的声明。
  }
  if (!context.electron) return null;
  const major = majorFromSpec(context.electron.spec);
  return major === null ? null : { major, version: context.electron.spec, origin: 'declared' };
}
