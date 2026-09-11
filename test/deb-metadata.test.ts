import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runDoctor } from '../src/index.ts';
import { debMetadata } from '../src/rules/deb-metadata.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string): string => path.join(fixtures, name);

test('deb-metadata passes when maintainer, category and icon directory are present', async () => {
  const report = await runDoctor({ cwd: fixture('electron-builder-deb'), rules: [debMetadata] });
  assert.deepEqual(report.findings, []);
});

test('deb-metadata reports missing homepage, maintainer, category and icon for electron-builder', async () => {
  const report = await runDoctor({ cwd: fixture('deb-missing-metadata'), rules: [debMetadata] });
  const titles = report.findings.map((finding) => `${finding.severity}:${finding.title}`);
  assert.deepEqual(titles, [
    'error:package.json 没有 homepage，也没有可用的 repository 地址',
    'error:package.json#build 未声明 maintainer，package.json 的 author 也没有邮箱',
    'info:package.json#build 未声明 linux.category，将使用默认值 Utility',
    'warning:package.json#build 未声明图标，且 build/icons/ 与 build/icon.png 都不存在',
  ]);
  assert.ok(report.findings.every((finding) => finding.verification === 'local'));
});

test('deb-metadata reports missing maintainer, icon and categories for Forge maker-deb', async () => {
  const report = await runDoctor({ cwd: fixture('forge-deb-missing-metadata'), rules: [debMetadata] });
  const severities = report.findings.map((finding) => finding.severity);
  assert.deepEqual(severities, ['warning', 'warning', 'info']);
});

test('deb-metadata stays silent when the configuration does not produce a DEB', async () => {
  for (const name of ['misconfigured', 'forge-no-deb', 'empty']) {
    const report = await runDoctor({ cwd: fixture(name), rules: [debMetadata] });
    assert.deepEqual(report.findings, [], name);
  }
});
