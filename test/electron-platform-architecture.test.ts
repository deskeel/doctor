import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeArch } from '../src/data/electron-releases.ts';
import { runDoctor } from '../src/index.ts';
import { electronPlatformArchitecture } from '../src/rules/electron-platform-architecture.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string): string => path.join(fixtures, name);
const rules = [electronPlatformArchitecture];

test('normalizeArch maps vendor and packager spellings to canonical names', () => {
  assert.equal(normalizeArch('x64'), 'x86_64');
  assert.equal(normalizeArch('AMD64'), 'x86_64');
  assert.equal(normalizeArch('arm64'), 'aarch64');
  assert.equal(normalizeArch('armhf'), 'armv7l');
  assert.equal(normalizeArch('loong64'), 'loongarch64');
  assert.equal(normalizeArch('sw64'), 'sw_64');
  assert.equal(normalizeArch('sparc'), null);
});

test('no declared arch produces no finding', async () => {
  for (const name of ['electron-builder-deb', 'misconfigured', 'forge-no-deb', 'empty']) {
    const report = await runDoctor({ cwd: fixture(name), rules });
    assert.deepEqual(report.findings, [], name);
  }
});

test('declared architectures are classified against the Electron artifact table', async () => {
  const report = await runDoctor({ cwd: fixture('arch-targets'), rules });
  const ids = report.findings.map((finding) => `${finding.severity}:${finding.title}`);
  assert.deepEqual(ids, [
    'info:目标架构 arm64（aarch64） 有 Electron 官方产物，但 doctor 当前只对 x86_64 做判定',
    'warning:目标架构 armv7l 自 Electron 44 起没有官方产物',
    'error:目标架构 loong64（loongarch64） 没有 Electron 官方产物',
    'info:无法识别的目标架构 "sparc"',
  ]);
  assert.equal(report.exitCode, 1);
  assert.ok(report.findings.every((finding) => finding.verification === 'local'));
  assert.deepEqual(report.findings[0]?.evidence, [
    'package.json#build 的 linux.target 声明了架构：x64、arm64、armv7l、loong64、sparc',
  ]);
});

test('armv7l on Electron 43 is only an info because artifacts still exist', async () => {
  const report = await runDoctor({ cwd: fixture('arch-armv7l-43'), rules });
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.severity, 'info');
  assert.match(report.findings[0]?.title ?? '', /Electron 44 起停发，当前 Electron 43 仍有产物/);
});
