import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderText, runDoctor, scanNativeModules } from '../src/index.ts';
import { nativeModuleAbi } from '../src/rules/native-module-abi.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string): string => path.join(fixtures, name);
const rules = [nativeModuleAbi];

test('scanNativeModules finds native packages, pnpm nested packages and their artifacts', async () => {
  const scan = await scanNativeModules(fixture('native-modules'));
  assert.equal(scan.nodeModulesFound, true);
  assert.deepEqual(
    scan.modules.map((module) => module.name),
    ['@scope/fake-pregyp', 'fake-arm64', 'fake-musl', 'fake-nested', 'fake-no-artifacts', 'fake-sqlite'],
  );
  const sqlite = scan.modules.find((module) => module.name === 'fake-sqlite');
  assert.deepEqual(sqlite?.signals, [
    'prebuilds/',
    '依赖 prebuild-install',
    'install 脚本调用 node-gyp / prebuild 工具',
  ]);
  const linux = sqlite?.artifacts.find((artifact) => artifact.platformTag === 'linux-x64');
  assert.equal(linux?.arch, 'x86_64');
  assert.equal(linux?.abiTag, 'abi116');
  assert.equal(linux?.glibc, '2.34');
  assert.equal(linux?.glibcxx, '3.4.29');
  assert.equal(linux?.cxxabi, '1.3.9');
  assert.equal(linux?.gcc, '3.0');
  assert.equal(linux?.musl, false);
  const darwin = sqlite?.artifacts.find((artifact) => artifact.platformTag === 'darwin-arm64');
  assert.equal(darwin?.elf, null);
  assert.equal(darwin?.arch, null);

  const pregyp = scan.modules.find((module) => module.name === '@scope/fake-pregyp');
  assert.equal(pregyp?.artifacts[0]?.abiTag, 'abi115');
  assert.equal(pregyp?.artifacts[0]?.platformTag, 'linux-x64');
  const musl = scan.modules.find((module) => module.name === 'fake-musl');
  assert.equal(musl?.artifacts[0]?.musl, true);
});

test('native-module-abi reports facts plus a device-verification conclusion per module', async () => {
  const report = await runDoctor({ cwd: fixture('native-modules'), rules });
  const rows = report.findings.map((finding) => `${finding.severity}/${finding.verification}: ${finding.title}`);
  assert.deepEqual(rows, [
    'warning/device: @scope/fake-pregyp@2.0.0 的 linux-x64 预编译要求 GLIBC_2.28',
    'info/local: fake-arm64@1.0.0 是原生模块，但本机没有 linux-x64 产物，扫描覆盖不足',
    'warning/local: fake-musl@1.0.0 的 linux-x64 产物只有 musl 构建',
    'warning/device: fake-nested@1.0.0 的 linux-x64 预编译要求 GLIBC_2.17',
    'info/local: fake-no-artifacts@1.0.0 是原生模块，但本机没有 linux-x64 产物，扫描覆盖不足',
    'warning/device: fake-sqlite@1.2.3 的 linux-x64 预编译要求 GLIBC_2.34、GLIBCXX_3.4.29、CXXABI_1.3.9',
  ]);
  assert.equal(report.summary.device, 3);
  assert.equal(report.exitCode, 0);

  const sqlite = report.findings.find((finding) => finding.title.startsWith('fake-sqlite'));
  assert.match(sqlite?.detail ?? '', /尚无官方或真机证据，需真机验证/);
  assert.deepEqual(sqlite?.evidence, [
    'node_modules/fake-sqlite：prebuilds/、依赖 prebuild-install、install 脚本调用 node-gyp / prebuild 工具',
    'node_modules/fake-sqlite/prebuilds/darwin-arm64/node.abi116.node（NODE_MODULE_VERSION 116）',
    'node_modules/fake-sqlite/prebuilds/linux-x64/node.abi116.node（x86_64，NODE_MODULE_VERSION 116，GLIBC_2.34，GLIBCXX_3.4.29，CXXABI_1.3.9，GCC_3.0）',
  ]);
  const arm = report.findings.find((finding) => finding.title.startsWith('fake-arm64'));
  assert.match(arm?.detail ?? '', /只找到 linux-arm64 的产物/);

  const text = renderText(report);
  assert.match(text, /3 项需要在统信 UOS \/ 银河麒麟真机上验证/);
});

test('native-module-abi reports a missing node_modules once and nothing for pure-JS trees', async () => {
  const missing = await runDoctor({ cwd: fixture('deb-missing-metadata'), rules });
  assert.equal(missing.findings.length, 1);
  assert.equal(missing.findings[0]?.severity, 'info');
  assert.match(missing.findings[0]?.title ?? '', /node_modules 不存在/);

  const clean = await runDoctor({ cwd: fixture('electron-builder-deb'), rules });
  assert.deepEqual(clean.findings, []);
  const empty = await runDoctor({ cwd: fixture('empty'), rules });
  assert.deepEqual(empty.findings, []);
});
