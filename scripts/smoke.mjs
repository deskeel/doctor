// 对构建产物做端到端冒烟：验证 CLI 在当前 Node 版本上可运行，退出码与 JSON 结构符合约定。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'cli.js');
const fixture = (name) => path.join(root, 'test', 'fixtures', name);

const cases = [
  { args: [fixture('electron-builder-deb')], exitCode: 0 },
  { args: [fixture('misconfigured')], exitCode: 1 },
  { args: ['--json', fixture('empty')], exitCode: 1, json: true },
  { args: ['--version'], exitCode: 0 },
];

let failed = 0;
for (const testCase of cases) {
  const result = spawnSync(process.execPath, [cli, ...testCase.args], { encoding: 'utf8' });
  let ok = result.status === testCase.exitCode;
  if (ok && testCase.json) {
    try {
      ok = JSON.parse(result.stdout).schemaVersion === 1;
    } catch {
      ok = false;
    }
  }
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${testCase.args.join(' ')} -> exit ${result.status}`);
  if (!ok) {
    failed += 1;
    console.log(result.stdout);
    console.error(result.stderr);
  }
}
process.exit(failed === 0 ? 0 : 1);
