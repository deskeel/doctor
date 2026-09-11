import type { Rule } from '../types.ts';
import { debMetadata } from './deb-metadata.ts';
import { electronDependency } from './electron-dependency.ts';
import { electronLifecycle } from './electron-lifecycle.ts';
import { electronPlatformArchitecture } from './electron-platform-architecture.ts';
import { linuxDebTarget } from './linux-deb-target.ts';
import { lockfile } from './lockfile.ts';
import { packageJson } from './package-json.ts';
import { productNameAscii } from './product-name-ascii.ts';

/**
 * 默认规则集。顺序即报告中同级别问题的顺序。
 * 只收录阈值来源明确的规则；尚无来源的候选规则不进入默认规则集。
 */
export const builtinRules: readonly Rule[] = [
  packageJson,
  electronDependency,
  electronLifecycle,
  electronPlatformArchitecture,
  lockfile,
  linuxDebTarget,
  debMetadata,
  productNameAscii,
];
