import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type Rule, renderJson, renderText, runDoctor } from '../src/index.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string): string => path.join(fixtures, name);

test('a well-configured electron-builder project has no findings', async () => {
  const report = await runDoctor({ cwd: fixture('electron-builder-deb') });
  assert.deepEqual(report.findings, []);
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.project, {
    name: 'demo-app',
    version: '1.2.3',
    electron: '^31.0.0',
    packageManager: 'pnpm',
    builder: 'electron-builder',
  });
});

test('an empty directory reports only the missing package.json', async () => {
  const report = await runDoctor({ cwd: fixture('empty') });
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.ruleId, 'package-json');
  assert.equal(report.findings[0]?.severity, 'error');
  assert.equal(report.exitCode, 1);
});

test('a Forge project without maker-deb fails linux-deb-target', async () => {
  const report = await runDoctor({ cwd: fixture('forge-no-deb') });
  const ids = report.findings.map((finding) => `${finding.ruleId}:${finding.severity}`);
  assert.deepEqual(ids, ['linux-deb-target:error']);
  assert.equal(report.project.builder, 'forge');
});

test('a misconfigured project reports electron, lockfile and target problems', async () => {
  const report = await runDoctor({ cwd: fixture('misconfigured') });
  const ids = report.findings.map((finding) => `${finding.ruleId}:${finding.severity}`).sort();
  assert.deepEqual(ids, [
    'electron-dependency:warning',
    'electron-dependency:warning',
    'linux-deb-target:error',
    'lockfile:error',
  ]);
  assert.equal(report.summary.error, 2);
  assert.equal(report.summary.warning, 2);
  assert.equal(report.exitCode, 1);
});

test('text report shows the device-verification note only for device findings', async () => {
  const clean = await runDoctor({ cwd: fixture('electron-builder-deb') });
  const cleanText = renderText(clean);
  assert.match(cleanText, /没有发现问题/);
  assert.doesNotMatch(cleanText, /真机/);

  const deviceRule: Rule = {
    id: 'fake-device',
    title: 'fake',
    description: 'fake',
    source: 'test',
    check: () => [{ ruleId: 'fake-device', severity: 'warning', verification: 'device', title: '需要真机确认的问题' }],
  };
  const withDevice = await runDoctor({ cwd: fixture('electron-builder-deb'), rules: [deviceRule] });
  const text = renderText(withDevice);
  assert.match(text, /\[需真机验证\]/);
  assert.match(text, /1 项需要在统信 UOS \/ 银河麒麟真机上验证/);
  assert.equal(withDevice.exitCode, 0);
});

test('json report round-trips', async () => {
  const report = await runDoctor({ cwd: fixture('misconfigured') });
  const parsed = JSON.parse(renderJson(report)) as typeof report;
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.summary.error, report.summary.error);
  assert.deepEqual(parsed.rules, report.rules);
});
