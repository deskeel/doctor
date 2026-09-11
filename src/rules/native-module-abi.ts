import { type NativeArtifact, type NativeModule, scanNativeModules } from '../native-modules.ts';
import type { Finding, Rule } from '../types.ts';

const RULE_ID = 'native-module-abi';
const TARGETS = '统信 UOS V20 / 银河麒麟 V10';

function label(module: NativeModule): string {
  return module.version ? `${module.name}@${module.version}` : module.name;
}

function isLinuxX64(artifact: NativeArtifact): boolean {
  if (artifact.arch === 'x86_64') return true;
  return artifact.elf === null && artifact.platformTag !== null && /^linux-x64/.test(artifact.platformTag);
}

function describeArtifact(artifact: NativeArtifact): string {
  const parts = [artifact.file];
  const facts: string[] = [];
  if (artifact.arch) facts.push(artifact.arch);
  if (artifact.abiTag) facts.push(`NODE_MODULE_VERSION ${artifact.abiTag.replace(/^abi/, '')}`);
  if (artifact.musl) facts.push('musl');
  if (artifact.glibc) facts.push(`GLIBC_${artifact.glibc}`);
  if (artifact.glibcxx) facts.push(`GLIBCXX_${artifact.glibcxx}`);
  if (artifact.cxxabi) facts.push(`CXXABI_${artifact.cxxabi}`);
  if (artifact.gcc) facts.push(`GCC_${artifact.gcc}`);
  if (artifact.parseError) facts.push(`解析失败：${artifact.parseError}`);
  if (facts.length > 0) parts.push(`（${facts.join('，')}）`);
  return parts.join('');
}

function requirementSummary(artifacts: NativeArtifact[]): string {
  const pick = (key: 'glibc' | 'glibcxx' | 'cxxabi', prefix: string): string | null => {
    const values = artifacts.map((artifact) => artifact[key]).filter((value): value is string => value !== null);
    if (values.length === 0) return null;
    const highest = values.sort((a, b) => compare(a, b))[values.length - 1] ?? null;
    return highest ? `${prefix}_${highest}` : null;
  };
  return [pick('glibc', 'GLIBC'), pick('glibcxx', 'GLIBCXX'), pick('cxxabi', 'CXXABI')].filter(Boolean).join('、');
}

function compare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function moduleFindings(module: NativeModule): Finding[] {
  const name = label(module);
  const evidence = [`${module.dir}：${module.signals.join('、')}`, ...module.artifacts.map(describeArtifact)];
  const linuxX64 = module.artifacts.filter(isLinuxX64);
  const glibcBuilds = linuxX64.filter((artifact) => artifact.elf !== null && !artifact.musl);
  const muslBuilds = linuxX64.filter((artifact) => artifact.elf !== null && artifact.musl);

  if (glibcBuilds.length > 0) {
    const summary = requirementSummary(glibcBuilds);
    if (summary === '') {
      return [
        {
          ruleId: RULE_ID,
          severity: 'info',
          verification: 'local',
          title: `${name} 的 linux-x64 产物没有声明带版本的 glibc 符号需求`,
          detail: '未从 .gnu.version_r 读到 GLIBC_* / GLIBCXX_* 版本，无法据此判断对目标系统的要求。',
          fix: '如果该模块是静态链接或不依赖 libc，可忽略；否则需在目标系统真机上验证加载。',
          evidence,
        },
      ];
    }
    return [
      {
        ruleId: RULE_ID,
        severity: 'warning',
        verification: 'device',
        title: `${name} 的 linux-x64 预编译要求 ${summary}`,
        detail: `${TARGETS} 的 glibc 与 libstdc++ 提供的符号版本尚无官方或真机证据，需真机验证该模块能否加载。`,
        fix: '在目标系统真机上安装并启动一次；若加载失败，可在目标系统上用 node-gyp 从源码重新编译，或选用 glibc 需求更低的预编译版本。',
        evidence,
      },
    ];
  }

  if (muslBuilds.length > 0) {
    return [
      {
        ruleId: RULE_ID,
        severity: 'warning',
        verification: 'local',
        title: `${name} 的 linux-x64 产物只有 musl 构建`,
        detail: `${TARGETS} 使用 glibc，链接 musl libc 的 .node 无法在其上加载。`,
        fix: '安装或构建 glibc 版本的预编译产物（prebuildify 的 glibc 变体，或在 glibc 系统上重新编译）。',
        evidence,
      },
    ];
  }

  const found = module.artifacts.map((artifact) => artifact.platformTag ?? artifact.arch ?? '未知平台');
  return [
    {
      ruleId: RULE_ID,
      severity: 'info',
      verification: 'local',
      title: `${name} 是原生模块，但本机没有 linux-x64 产物，扫描覆盖不足`,
      detail:
        found.length > 0
          ? `本机只找到 ${[...new Set(found)].join('、')} 的产物，无法读出 linux-x64 版本对 glibc 的要求。`
          : '本机没有找到任何 .node 产物（可能安装时从源码编译失败，或产物位于 doctor 未扫描的目录）。',
      fix: '在 Linux x86_64 构建机上安装依赖后再运行 doctor，或在目标系统真机上验证该模块。',
      evidence,
    },
  ];
}

export const nativeModuleAbi: Rule = {
  id: RULE_ID,
  title: '原生模块的 Linux x86_64 产物及其 glibc / libstdc++ 需求已读出',
  description:
    '识别 node_modules 里的原生模块（binding.gyp、prebuilds/、node-gyp-build / prebuild-install / node-pre-gyp 依赖、install 脚本），只读解析已有的 .node 产物，报出架构、NODE_MODULE_VERSION 与 GLIBC_* / GLIBCXX_* 需求。',
  source:
    'Node.js ABI 稳定性与 NODE_MODULE_VERSION：https://nodejs.org/api/n-api.html#abi-stability、https://nodejs.org/en/download/releases；Electron 原生模块指南：https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules；glibc 符号版本机制：https://sourceware.org/binutils/docs/ld/VERSION.html；prebuildify 产物命名：https://github.com/prebuild/prebuildify#naming',
  async check(context) {
    if (!context.packageJson) return [];
    const scan = await scanNativeModules(context.cwd);
    if (!scan.nodeModulesFound) {
      return [
        {
          ruleId: RULE_ID,
          severity: 'info',
          verification: 'local',
          title: 'node_modules 不存在，未扫描原生模块',
          detail: '原生模块的 glibc / libstdc++ 需求只能从已安装的 .node 产物中读出。',
          fix: '安装依赖后再运行 doctor。',
        },
      ];
    }
    return scan.modules.flatMap(moduleFindings);
  },
};
