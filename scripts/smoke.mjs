// 对构建产物做端到端冒烟：验证 CLI 在当前 Node 版本上可运行，退出码与 JSON 结构符合约定。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.DOCTOR_SMOKE_CLI ?? path.join(root, 'dist', 'cli.js');
const fixture = (name) => path.join(root, 'test', 'fixtures', name);

const cases = [
  { args: [fixture('electron-builder-deb')], exitCode: 0 },
  { args: [fixture('misconfigured')], exitCode: 1 },
  { args: [fixture('deb-missing-metadata')], exitCode: 1 },
  { args: [fixture('non-ascii-name')], exitCode: 1 },
  { args: [fixture('arch-targets')], exitCode: 1 },
  { args: [fixture('native-modules')], exitCode: 0, device: true },
  { args: ['--json', fixture('empty')], exitCode: 1, json: true },
  { args: ['--json', fixture('native-modules')], exitCode: 0, json: true, rules: 9 },
  { args: ['--version'], exitCode: 0 },
  { args: ['--help'], exitCode: 0 },
  { args: ['--target'], exitCode: 2 },
  { args: ['--target', 'invalid'], exitCode: 2 },
  { args: ['--channel', 'store'], exitCode: 2 },
  { args: ['--target', 'uos-v20', '--channel', 'invalid'], exitCode: 2 },
  { args: ['inspect'], exitCode: 2 },
  { args: ['inspect', 'missing.deb', '--json'], exitCode: 2, inspect: true, completion: 'incomplete' },
  {
    args: [fixture('electron-builder-deb'), '--target', 'uos-v20', '--channel', 'direct', '--json'],
    exitCode: 0,
    json: true,
    packaging: true,
  },
  {
    args: [
      'inspect',
      fixture('deb/com.example.app_1.2.3_amd64.deb'),
      '--target',
      'uos-v20',
      '--channel',
      'store',
      '--json',
    ],
    exitCode: 0,
    inspect: true,
    completion: 'complete',
  },
  {
    args: ['inspect', fixture('deb/kylin.deb'), '--target', 'kylin-v10', '--channel', 'direct', '--json'],
    exitCode: 0,
    inspect: true,
    completion: 'complete',
  },
  { args: ['inspect', fixture('deb/unsafe.deb'), '--json'], exitCode: 2, inspect: true, completion: 'incomplete' },
  { args: ['inspect', fixture('deb/com.example.app_1.2.3_amd64.deb'), '--no-color'], exitCode: 0, inspectText: true },
];

let failed = 0;
for (const testCase of cases) {
  const result = spawnSync(process.execPath, [cli, ...testCase.args], { encoding: 'utf8' });
  let ok = result.status === testCase.exitCode;
  if (ok && (testCase.json || testCase.inspect)) {
    try {
      const report = JSON.parse(result.stdout);
      ok = report.schemaVersion === 1 && (testCase.rules === undefined || report.rules.length === testCase.rules);
      if (testCase.packaging) ok &&= report.packaging?.channel === 'direct';
      if (testCase.inspect)
        ok &&=
          report.inputType === 'deb' &&
          report.completion === testCase.completion &&
          report.exitCode === testCase.exitCode &&
          report.coverage.some((c) => c.status === 'unknown');
    } catch {
      ok = false;
    }
  }
  if (ok && testCase.inspectText)
    ok = result.stdout.includes('deb-runtime') && result.stdout.includes('来源：') && result.stdout.includes('unknown');
  if (ok && testCase.device) ok = /真机上验证/.test(result.stdout);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${testCase.args.join(' ')} -> exit ${result.status}`);
  if (!ok) {
    failed += 1;
    console.log(result.stdout);
    console.error(result.stderr);
  }
}
process.exit(failed === 0 ? 0 : 1);
