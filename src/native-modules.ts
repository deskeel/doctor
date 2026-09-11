/**
 * 只读扫描 node_modules 里的原生模块及其已存在的二进制产物。
 * 不执行任何脚本，不下载，不写入。
 */
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LinuxArch } from './data/electron-releases.ts';
import { type ElfInfo, ElfParseError, highestSymbolVersion, isElf, isMuslBinary, parseElf } from './elf.ts';

const NATIVE_DEPENDENCIES = [
  'node-gyp-build',
  'prebuild-install',
  '@mapbox/node-pre-gyp',
  'node-pre-gyp',
  'cmake-js',
  'node-addon-api',
  'nan',
];
const NATIVE_SCRIPT = /node-gyp|prebuild-install|node-gyp-build|node-pre-gyp|cmake-js/;
/** 相对包根目录的产物位置；数字是向下遍历的层数。 */
const ARTIFACT_DIRS: ReadonlyArray<[string, number]> = [
  ['prebuilds', 2],
  ['build/Release', 1],
  ['lib/binding', 3],
];
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

export interface NativeArtifact {
  /** 相对工程根目录的路径。 */
  file: string;
  /** 从路径推断的平台标签，例如 linux-x64、darwin-arm64；无法推断时为 null。 */
  platformTag: string | null;
  /** 从文件名或路径推断的 NODE_MODULE_VERSION，例如 abi116、napi、electron-v31.0。 */
  abiTag: string | null;
  /** 非 ELF（Mach-O、PE）或解析失败时为 null。 */
  elf: ElfInfo | null;
  parseError?: string;
  arch: LinuxArch | null;
  musl: boolean;
  glibc: string | null;
  glibcxx: string | null;
  cxxabi: string | null;
  gcc: string | null;
}

export interface NativeModule {
  name: string;
  version: string | null;
  /** 相对工程根目录的包目录。 */
  dir: string;
  /** 被判定为原生模块的依据。 */
  signals: string[];
  artifacts: NativeArtifact[];
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory() || entry.isSymbolicLink()) names.push(entry.name);
    }
    return names;
  } catch {
    return [];
  }
}

/** 列出 node_modules 下所有包目录：直接依赖、scope 包，以及 pnpm 虚拟仓库里的一层。 */
async function packageDirs(nodeModules: string): Promise<string[]> {
  const result: string[] = [];
  const addFrom = async (root: string): Promise<void> => {
    for (const name of await listDirs(root)) {
      if (name.startsWith('@')) {
        for (const inner of await listDirs(path.join(root, name))) result.push(path.join(root, name, inner));
      } else {
        result.push(path.join(root, name));
      }
    }
  };
  await addFrom(nodeModules);
  for (const entry of await listDirs(path.join(nodeModules, '.pnpm'))) {
    await addFrom(path.join(nodeModules, '.pnpm', entry, 'node_modules'));
  }
  return result;
}

interface PackageMeta {
  name?: unknown;
  version?: unknown;
  gypfile?: unknown;
  binary?: unknown;
  dependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
}

async function readMeta(dir: string): Promise<PackageMeta | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as PackageMeta) : null;
  } catch {
    return null;
  }
}

async function nativeSignals(dir: string, meta: PackageMeta): Promise<string[]> {
  const signals: string[] = [];
  if (await exists(path.join(dir, 'binding.gyp'))) signals.push('binding.gyp');
  if (meta.gypfile === true) signals.push('package.json#gypfile');
  if (await exists(path.join(dir, 'prebuilds'))) signals.push('prebuilds/');
  if (typeof meta.binary === 'object' && meta.binary !== null) signals.push('package.json#binary（node-pre-gyp）');
  const deps = { ...(meta.dependencies ?? {}), ...(meta.optionalDependencies ?? {}) };
  for (const name of NATIVE_DEPENDENCIES) if (name in deps) signals.push(`依赖 ${name}`);
  const install = meta.scripts?.install;
  if (typeof install === 'string' && NATIVE_SCRIPT.test(install))
    signals.push('install 脚本调用 node-gyp / prebuild 工具');
  return signals;
}

async function walkNodeFiles(dir: string, depth: number): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.node')) files.push(full);
    else if (depth > 0 && entry.isDirectory()) files.push(...(await walkNodeFiles(full, depth - 1)));
  }
  return files;
}

const PLATFORM_TAG = /(?:^|[\\/-])((?:linux|darwin|win32|android|freebsd)-[a-z0-9_+]+(?:-(?:glibc|musl))?)(?=[\\/]|$)/;
const ABI_TAG = /(?:^|[.\\/-])(abi\d+|napi|node-v\d+|electron-v\d+(?:\.\d+)?)(?=[.\\/-]|$)/;

function tagsFromPath(relative: string): { platformTag: string | null; abiTag: string | null } {
  const platform = PLATFORM_TAG.exec(relative);
  const abi = ABI_TAG.exec(relative);
  let abiTag = abi?.[1] ?? null;
  if (abiTag?.startsWith('node-v')) abiTag = `abi${abiTag.slice(6)}`;
  return { platformTag: platform?.[1] ?? null, abiTag };
}

async function inspectArtifact(cwd: string, file: string): Promise<NativeArtifact> {
  const relative = path.relative(cwd, file).split(path.sep).join('/');
  const artifact: NativeArtifact = {
    file: relative,
    ...tagsFromPath(relative),
    elf: null,
    arch: null,
    musl: false,
    glibc: null,
    glibcxx: null,
    cxxabi: null,
    gcc: null,
  };
  try {
    const info = await stat(file);
    if (info.size > MAX_ARTIFACT_BYTES) {
      artifact.parseError = `文件超过 ${MAX_ARTIFACT_BYTES / 1024 / 1024} MB，未读取`;
      return artifact;
    }
    const buffer = await readFile(file);
    if (!isElf(buffer)) return artifact;
    const elf = parseElf(buffer);
    artifact.elf = elf;
    artifact.arch = elf.arch;
    artifact.musl = isMuslBinary(elf) || /\.musl\.node$/.test(relative);
    artifact.glibc = highestSymbolVersion(elf, 'GLIBC');
    artifact.glibcxx = highestSymbolVersion(elf, 'GLIBCXX');
    artifact.cxxabi = highestSymbolVersion(elf, 'CXXABI');
    artifact.gcc = highestSymbolVersion(elf, 'GCC');
  } catch (error) {
    artifact.parseError = error instanceof ElfParseError ? error.message : (error as Error).message;
  }
  return artifact;
}

export interface NativeScan {
  /** node_modules 是否存在。 */
  nodeModulesFound: boolean;
  modules: NativeModule[];
}

export async function scanNativeModules(cwd: string): Promise<NativeScan> {
  const nodeModules = path.join(cwd, 'node_modules');
  if (!(await exists(nodeModules))) return { nodeModulesFound: false, modules: [] };

  const seen = new Set<string>();
  const modules: NativeModule[] = [];
  for (const dir of await packageDirs(nodeModules)) {
    let real: string;
    try {
      real = await realpath(dir);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);

    const meta = await readMeta(real);
    if (!meta) continue;
    const signals = await nativeSignals(real, meta);
    if (signals.length === 0) continue;

    const artifacts: NativeArtifact[] = [];
    for (const [sub, depth] of ARTIFACT_DIRS) {
      for (const file of await walkNodeFiles(path.join(real, sub), depth)) {
        artifacts.push(await inspectArtifact(cwd, file));
      }
    }
    artifacts.sort((a, b) => a.file.localeCompare(b.file));

    modules.push({
      name: typeof meta.name === 'string' ? meta.name : path.basename(dir),
      version: typeof meta.version === 'string' ? meta.version : null,
      dir: path.relative(cwd, dir).split(path.sep).join('/'),
      signals,
      artifacts,
    });
  }
  modules.sort((a, b) => a.name.localeCompare(b.name));
  return { nodeModulesFound: true, modules };
}
