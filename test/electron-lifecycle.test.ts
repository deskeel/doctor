import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { majorFromSpec } from '../src/electron-version.ts';
import { ELECTRON_RELEASES, runDoctor } from '../src/index.ts';
import { electronLifecycle } from '../src/rules/electron-lifecycle.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string): string => path.join(fixtures, name);
const rules = [electronLifecycle];
const asOf = new Date(`${ELECTRON_RELEASES.dataAsOf}T12:00:00Z`);

test('majorFromSpec reads the first major from common range syntaxes', () => {
  assert.equal(majorFromSpec('^31.0.0'), 31);
  assert.equal(majorFromSpec('~44.1'), 44);
  assert.equal(majorFromSpec('>=42.0.0 <44'), 42);
  assert.equal(majorFromSpec('v40.2.1'), 40);
  assert.equal(majorFromSpec('44'), 44);
  assert.equal(majorFromSpec('latest'), null);
  assert.equal(majorFromSpec('*'), null);
});

test('a supported Electron major produces no finding', async () => {
  const report = await runDoctor({ cwd: fixture('electron-builder-deb'), rules, now: asOf });
  assert.deepEqual(report.findings, []);
});

test('a major older than the release table is reported as unmaintained', async () => {
  const report = await runDoctor({ cwd: fixture('deb-missing-metadata'), rules, now: asOf });
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.severity, 'warning');
  assert.match(report.findings[0]?.title ?? '', /声明的 Electron 31\.0\.0 已停止维护/);
  assert.match(report.findings[0]?.fix ?? '', /42、43、44/);
  assert.deepEqual(report.findings[0]?.evidence, ['Electron 发布表数据截至 2026-09-10']);
});

test('a major in the table past its EOL date is reported with the date', async () => {
  const report = await runDoctor({ cwd: fixture('electron-installed'), rules, now: new Date('2026-11-01T00:00:00Z') });
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.title, '已安装的 Electron 42.11.3 已于 2026-10-20 停止维护');
});

test('the installed version takes precedence over the declared range', async () => {
  const report = await runDoctor({ cwd: fixture('electron-installed'), rules, now: asOf });
  assert.deepEqual(report.findings, []);
});

test('a major newer than the table is an info finding', async () => {
  const report = await runDoctor({ cwd: fixture('electron-unknown-major'), rules, now: asOf });
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.severity, 'info');
  assert.match(report.findings[0]?.title ?? '', /比 doctor 内置的发布表更新/);
});

test('stale release data adds an info finding after 90 days', async () => {
  const report = await runDoctor({
    cwd: fixture('electron-builder-deb'),
    rules,
    now: new Date('2026-12-20T00:00:00Z'),
  });
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.severity, 'info');
  assert.match(report.findings[0]?.title ?? '', /发布窗口信息可能过期/);

  const fresh = await runDoctor({ cwd: fixture('electron-builder-deb'), rules, now: new Date('2026-12-08T00:00:00Z') });
  assert.deepEqual(fresh.findings, []);
});

test('unparseable ranges produce no lifecycle finding', async () => {
  const report = await runDoctor({ cwd: fixture('misconfigured'), rules, now: asOf });
  assert.deepEqual(report.findings, []);
});
