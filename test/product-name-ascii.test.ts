import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runDoctor } from '../src/index.ts';
import { productNameAscii } from '../src/rules/product-name-ascii.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string): string => path.join(fixtures, name);

test('product-name-ascii passes for ASCII names', async () => {
  for (const name of ['electron-builder-deb', 'deb-missing-metadata', 'forge-deb-missing-metadata']) {
    const report = await runDoctor({ cwd: fixture(name), rules: [productNameAscii] });
    assert.deepEqual(report.findings, [], name);
  }
});

test('product-name-ascii reports a scoped package whose productName is non-ASCII', async () => {
  const report = await runDoctor({ cwd: fixture('non-ascii-name'), rules: [productNameAscii] });
  const ids = report.findings.map((finding) => `${finding.severity}:${finding.title}`);
  assert.deepEqual(ids, [
    'error:DEB 包名 "办公助手"（来自 productName（name 带 scope））含 dpkg 不接受的字符',
    'warning:productName "办公助手" 含非 ASCII 字符，将成为可执行文件名或安装目录名',
  ]);
  assert.equal(report.exitCode, 1);
});

test('product-name-ascii reports a Forge productName that becomes the executable name', async () => {
  const report = await runDoctor({ cwd: fixture('forge-non-ascii-name'), rules: [productNameAscii] });
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.severity, 'warning');
  assert.match(report.findings[0]?.title ?? '', /^productName "办公助手"/);
});

test('product-name-ascii stays silent when no DEB is produced', async () => {
  for (const name of ['misconfigured', 'forge-no-deb', 'empty']) {
    const report = await runDoctor({ cwd: fixture(name), rules: [productNameAscii] });
    assert.deepEqual(report.findings, [], name);
  }
});
