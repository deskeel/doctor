import { access, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  BuilderConfig,
  ElectronDependency,
  LockfileInfo,
  PackageJson,
  PackageManager,
  ProjectContext,
} from './types.ts';

const LOCKFILES: ReadonlyArray<[string, PackageManager]> = [
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

const BUILDER_STATIC_FILES = ['electron-builder.yml', 'electron-builder.yaml', 'electron-builder.json'];
const BUILDER_DYNAMIC_FILES = [
  'electron-builder.js',
  'electron-builder.cjs',
  'electron-builder.mjs',
  'electron-builder.ts',
  'electron-builder.json5',
  'electron-builder.toml',
];
const FORGE_DYNAMIC_FILES = ['forge.config.js', 'forge.config.cjs', 'forge.config.mjs', 'forge.config.ts'];

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readPackageJson(cwd: string): Promise<{ packageJson: PackageJson | null; error?: string }> {
  const file = path.join(cwd, 'package.json');
  if (!(await exists(file))) return { packageJson: null };
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!isRecord(parsed)) return { packageJson: null, error: 'package.json 的顶层不是对象' };
    return { packageJson: parsed as PackageJson };
  } catch (error) {
    return { packageJson: null, error: `package.json 无法解析：${(error as Error).message}` };
  }
}

async function findLockfiles(cwd: string): Promise<LockfileInfo[]> {
  const found: LockfileInfo[] = [];
  for (const [file, packageManager] of LOCKFILES) {
    if (await exists(path.join(cwd, file))) found.push({ file, packageManager });
  }
  return found;
}

function findElectron(packageJson: PackageJson | null): ElectronDependency | null {
  if (!packageJson) return null;
  const dev = packageJson.devDependencies?.electron;
  if (typeof dev === 'string') return { spec: dev, field: 'devDependencies' };
  const prod = packageJson.dependencies?.electron;
  if (typeof prod === 'string') return { spec: prod, field: 'dependencies' };
  return null;
}

async function parseStaticConfig(
  file: string,
  cwd: string,
): Promise<{ config: Record<string, unknown> | null; error?: string }> {
  try {
    const root = await realpath(cwd);
    const actual = await realpath(file);
    if (!actual.startsWith(`${root}${path.sep}`)) return { config: null, error: '配置指向工程外，未读取' };
    const text = await readFile(actual, 'utf8');
    const parsed: unknown = file.endsWith('.json') ? JSON.parse(text) : parseYaml(text);
    if (!isRecord(parsed)) return { config: null, error: '配置文件顶层不是对象' };
    return { config: parsed };
  } catch (error) {
    return { config: null, error: (error as Error).message };
  }
}

async function detectBuilder(cwd: string, packageJson: PackageJson | null): Promise<BuilderConfig | null> {
  if (isRecord(packageJson?.build)) {
    return { kind: 'electron-builder', file: 'package.json#build', config: packageJson.build };
  }
  for (const file of BUILDER_STATIC_FILES) {
    if (await exists(path.join(cwd, file))) {
      return { kind: 'electron-builder', file, ...(await parseStaticConfig(path.join(cwd, file), cwd)) };
    }
  }
  for (const file of BUILDER_DYNAMIC_FILES) {
    if (await exists(path.join(cwd, file))) return { kind: 'electron-builder', file, config: null };
  }

  const forge = packageJson?.config?.forge;
  if (isRecord(forge)) return { kind: 'forge', file: 'package.json#config.forge', config: forge };
  if (typeof forge === 'string') {
    if (forge.endsWith('.json'))
      return { kind: 'forge', file: forge, ...(await parseStaticConfig(path.resolve(cwd, forge), cwd)) };
    return { kind: 'forge', file: forge, config: null };
  }
  for (const file of FORGE_DYNAMIC_FILES) {
    if (await exists(path.join(cwd, file))) return { kind: 'forge', file, config: null };
  }
  return null;
}

export async function loadProjectContext(cwd: string, now: Date = new Date()): Promise<ProjectContext> {
  const { packageJson, error } = await readPackageJson(cwd);
  const [lockfiles, builder] = await Promise.all([findLockfiles(cwd), detectBuilder(cwd, packageJson)]);
  return {
    cwd,
    now,
    packageJson,
    ...(error ? { packageJsonError: error } : {}),
    lockfiles,
    electron: findElectron(packageJson),
    builder,
  };
}
