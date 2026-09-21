import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { runDoctor } from '../src/engine.ts';
import { DEFAULT_LIMITS, decompress, parseTar } from '../src/packaging/archive.ts';
import { inspectDeb, parseControl, renderInspectText, validDebVersion } from '../src/packaging/inspect.ts';
import { type PackagingOptions, validatePackagingOptions } from '../src/packaging/profile.ts';
import { ar, control, deb, desktop, payload, tar } from './helpers/deb.ts';

async function fixture(bytes: Buffer, fn: (file: string, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'doctor-deb-'));
  const file = path.join(dir, 'com.example.app_1.2.3_amd64.deb');
  try {
    await writeFile(file, bytes);
    await fn(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const contexts: PackagingOptions[] = [
  {},
  { target: 'uos-v20', channel: 'store' },
  { target: 'uos-v20', channel: 'direct' },
  { target: 'uos-v20', channel: 'enterprise' },
  { target: 'kylin-v10', channel: 'store' },
  { target: 'kylin-v10', channel: 'direct' },
];
test('synthetic DEB context matrix, read-only and text/JSON evidence', async () => {
  for (const context of contexts)
    await fixture(deb(payload(context.target !== 'kylin-v10')), async (file) => {
      const before = createHash('sha256')
        .update(await readFile(file))
        .digest('hex');
      const report = await inspectDeb(file, context);
      assert.equal(report.exitCode, 0);
      assert.equal(report.completion, 'complete');
      assert.equal(report.coverage.find((c) => c.ruleId === 'deb-runtime')?.status, 'unknown');
      assert.equal(
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
        before,
      );
      assert.deepEqual(await readdir(path.dirname(file)), [path.basename(file)]);
      const text = renderInspectText(report);
      for (const f of report.findings) {
        assert.ok(text.includes(f.ruleId));
        assert.ok(text.includes(f.source as string));
      }
      assert.equal(
        report.findings.some((f) => f.ruleId === 'deb-uos-info'),
        context.target === 'uos-v20' && context.channel === 'store',
      );
    });
});
test('uncompressed, xz and zstd formats', async (t) => {
  await fixture(deb(payload(), undefined, ''), async (file) => assert.equal((await inspectDeb(file)).exitCode, 0));
  for (const [tool, ext] of [
    ['xz', 'xz'],
    ['zstd', 'zst'],
  ] as const) {
    const compress = (b: Buffer) => spawnSync(tool, ['-c'], { input: b });
    if (compress(Buffer.from('test')).error) {
      t.diagnostic(`${tool} unavailable; optional codec not tested`);
      continue;
    }
    await fixture(
      ar([
        ['debian-binary', Buffer.from('2.0\n')],
        [`control.tar.${ext}`, compress(tar([{ name: 'control', content: control }])).stdout],
        [`data.tar.${ext}`, compress(tar(payload())).stdout],
      ]),
      async (file) => assert.equal((await inspectDeb(file)).exitCode, 0),
    );
  }
});
test('host ar and tar accept standard synthetic fixture', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Host POSIX ar/tar validation runs on macOS/Linux');
    return;
  }
  await fixture(deb(payload(), undefined, ''), async (file) => {
    const result = spawnSync('/usr/bin/ar', ['t', file], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /data.tar/);
  });
  const result = spawnSync('/usr/bin/tar', ['-tf', '-'], { input: tar(payload()), encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /files\/app/);
});
test('malicious archive structures never complete', async () => {
  const malicious = [
    deb([{ name: '../escape' }]),
    deb([{ name: '/absolute' }]),
    deb([{ name: 'a' }, { name: './a' }]),
    deb([
      { name: 'a', type: '2', link: 'b' },
      { name: 'b', type: '2', link: 'a' },
    ]),
    deb([{ name: 'a', type: '1', link: '../../escape' }]),
    deb([{ name: 'a', type: 'x' }]),
    deb([{ name: 'a', type: '2', link: 'b' }, { name: 'a/child' }]),
    deb().subarray(0, -15),
    deb(payload(), undefined, 'bz2'),
    ar([
      ['debian-binary', Buffer.from('2.0\n')],
      ['control.tar', tar([])],
      ['control.tar', tar([])],
      ['data.tar', tar([])],
    ]),
    ar([
      ['debian-binary', Buffer.from('2.0\n')],
      ['control.tar', tar([])],
      ['control.tar.gz', gzipSync(tar([]))],
      ['data.tar', tar([])],
    ]),
  ];
  for (const bytes of malicious)
    await fixture(bytes, async (file) => {
      const r = await inspectDeb(file);
      assert.equal(r.exitCode, 2);
      assert.equal(r.completion, 'incomplete');
    });
});
test('bounded input, entry, expanded bytes and member counts', async () => {
  for (const limits of [
    { inputBytes: 10 },
    { expandedBytes: 100 },
    { entryBytes: 10 },
    { entries: 1 },
    { arMembers: 1 },
  ])
    await fixture(deb(), async (file) => assert.equal((await inspectDeb(file, { limits })).exitCode, 2));
  assert.throws(() => parseTar(tar([{ name: 'x' }]).subarray(0, 512), DEFAULT_LIMITS));
  const corrupt = tar([{ name: 'x' }]);
  corrupt[0] = 42;
  assert.throws(() => parseTar(corrupt, DEFAULT_LIMITS), /校验/);
});
test('control grammar, Debian versions and duplicate keys', () => {
  for (const version of ['1.2.3', '1:2.0~rc1-3+deb12u1', '1.0+git2026', '1.0-1']) assert.ok(validDebVersion(version));
  for (const version of ['abc', '1.0-', '1.0 1', '1:abc']) assert.equal(validDebVersion(version), false);
  assert.throws(() => parseControl('Package: a\npackage: b\n'), /重复/);
  assert.equal(parseControl('Description: one\n two\n').description, 'one\ntwo');
});
test('rule failures and script conflict are distinct from parse failures; scripts never run', async () => {
  const entries = payload();
  entries[0] = { name: 'opt/apps/com.example.app/files/app', mode: 0o4777, uid: 1000 };
  entries[1] = {
    name: 'opt/apps/com.example.app/entries/applications/app.desktop',
    content: '[Desktop Entry]\nName=Bad\nExec=/missing\nIcon=relative/icon.png\nTerminal=maybe\n',
  };
  entries[3] = { name: 'opt/apps/com.example.app/info', content: '{' };
  await fixture(
    deb(entries, [
      { name: 'control', content: control.replace('Maintainer: Test <test@example.org>\n', '') },
      { name: 'postinst', content: '#!/bin/sh\ntouch DOCTOR_MUST_NOT_EXECUTE\n', mode: 0o755 },
    ]),
    async (file, dir) => {
      const report = await inspectDeb(file, { target: 'uos-v20', channel: 'store' });
      assert.equal(report.exitCode, 1);
      assert.deepEqual(report.scripts, ['postinst']);
      assert.ok(report.findings.some((f) => f.ruleId === 'deb-scripts' && f.severity === 'warning'));
      for (const id of ['deb-control', 'deb-desktop', 'deb-icon', 'deb-uos-info', 'deb-permissions'])
        assert.ok(
          report.findings.some((f) => f.ruleId === id && f.severity === 'error'),
          id,
        );
      assert.deepEqual(await readdir(dir), [path.basename(file)]);
    },
  );
  await fixture(deb([], [{ name: 'control', content: `${control}Package: duplicate\n` }]), async (file) =>
    assert.equal((await inspectDeb(file)).exitCode, 2),
  );
});
test('context validation and default report compatibility', async () => {
  for (const context of [{ channel: 'store' }, { target: 'bad' }, { target: 'uos-v20', channel: 'bad' }])
    assert.throws(() => validatePackagingOptions(context as PackagingOptions));
  const report = await runDoctor({ cwd: 'test/fixtures/electron-builder-deb' });
  assert.equal(report.rules.length, 9);
  assert.equal(report.schemaVersion, 1);
  assert.equal(Object.hasOwn(report, 'packaging'), false);
});
test('project context matrix and observable configuration only', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'doctor-project-'));
  try {
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'ordinary-app',
        dependencies: { 'electron-updater': '*' },
        build: { appId: 'com.example.app', linux: { target: 'deb' }, deb: { afterInstall: 'missing.sh' } },
      }),
    );
    for (const context of contexts) {
      const report = await runDoctor({ cwd: dir, ...context });
      assert.equal(
        report.findings.some((f) => f.ruleId === 'packaging-updater'),
        context.target === 'uos-v20' && context.channel === 'store',
      );
      assert.equal(
        report.findings.some((f) => f.ruleId === 'packaging-name' && f.severity === 'error'),
        context.target === 'uos-v20' && context.channel === 'store',
      );
      if (context.target) {
        assert.ok(report.findings.some((f) => f.ruleId === 'packaging-scripts'));
        assert.ok(report.packaging?.coverage.some((c) => c.ruleId === 'packaging-desktop' && c.status === 'unknown'));
      }
    }
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    await writeFile(
      path.join(dir, 'electron-builder.cjs'),
      `require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'EXECUTED'))}, 'bad'); throw new Error('MUST_NOT_EXECUTE');`,
    );
    const report = await runDoctor({ cwd: dir, target: 'uos-v20', channel: 'store' });
    assert.ok(report.findings.some((f) => f.ruleId === 'packaging-config'));
    assert.ok(report.packaging?.coverage.every((c) => c.status === 'unknown'));
    await assert.rejects(access(path.join(dir, 'EXECUTED')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('external codecs missing, corrupt or timed out never pass; archive bytes are stdin', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'doctor-codec-'));
  const original = process.env.PATH;
  try {
    process.env.PATH = dir;
    await assert.rejects(decompress('data.tar.xz', Buffer.from('bad'), 4096, 1000), /无法使用/);
    if (process.platform === 'win32') {
      t.diagnostic('POSIX fake-codec timeout test not applicable on Windows');
      return;
    }
    const tool = path.join(dir, 'xz');
    await writeFile(tool, `#!${process.execPath}\nsetTimeout(() => {}, 10000);`);
    await chmod(tool, 0o755);
    const start = Date.now();
    await assert.rejects(decompress('data.tar.xz', Buffer.from('bad'), 4096, 50), /超时|解压失败/);
    assert.ok(Date.now() - start < 5000);
    await writeFile(tool, `#!${process.execPath}\nprocess.stdin.resume(); process.stdout.write(Buffer.alloc(10000));`);
    // Allow process startup on loaded hosts; the dedicated timeout case above stays at 50 ms.
    await assert.rejects(decompress('data.tar.xz', Buffer.from('bad'), 100, 10000), /超限/);
    await writeFile(tool, `#!${process.execPath}\nprocess.stderr.write('corrupt'); process.exit(1);`);
    await assert.rejects(decompress('data.tar.xz', Buffer.from('bad'), 100, 10000), /解压失败/);
  } finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
    await rm(dir, { recursive: true, force: true });
  }
});
test('tar entry budgets apply while decompressing, and link resolution handles package-root references', async () => {
  const big = tar([{ name: 'big', content: Buffer.alloc(100000) }]);
  await assert.rejects(
    decompress('data.tar.gz', gzipSync(big), 1024 ** 2, 1000, { ...DEFAULT_LIMITS, entryBytes: 100 }),
    /解压过程中/,
  );
  await assert.rejects(
    decompress('data.tar.gz', gzipSync(tar([{ name: 'a' }, { name: 'b' }])), 1024 ** 2, 1000, {
      ...DEFAULT_LIMITS,
      entries: 1,
    }),
    /解压过程中/,
  );
  await fixture(
    deb([...payload(), { name: 'usr/bin/app', type: '2', mode: 0o777, link: '/opt/apps/com.example.app/files/app' }]),
    async (file) => {
      const report = await inspectDeb(file);
      assert.equal(report.exitCode, 0);
      assert.ok(!report.findings.some((f) => f.title.includes('写入')));
    },
  );
});
test('target layout, info consistency, permission types, restricted paths and non-amd64 boundaries', async () => {
  await fixture(deb([{ name: 'outside', content: 'x' }]), async (file) => {
    const report = await inspectDeb(file, { target: 'kylin-v10', channel: 'direct' });
    assert.equal(report.exitCode, 1);
    assert.ok(report.findings.some((f) => f.ruleId === 'deb-layout'));
  });
  const entries = payload();
  entries[3] = {
    name: 'opt/apps/com.example.app/info',
    content: JSON.stringify({ appid: 'other', version: '2.0', arch: 'amd64', permissions: { autostart: 'true' } }),
  };
  entries.push({ name: 'usr/share/dbus-1/system.d/service.conf' });
  await fixture(deb(entries), async (file) => {
    const report = await inspectDeb(file, { target: 'uos-v20', channel: 'store' });
    assert.ok(report.findings.filter((f) => f.ruleId === 'deb-uos-info' && f.severity === 'error').length >= 4);
    assert.ok(report.findings.some((f) => f.ruleId === 'deb-permissions' && f.severity === 'error'));
  });
  await fixture(deb([], [{ name: 'control', content: control.replace('amd64', 'arm64') }]), async (file) => {
    const report = await inspectDeb(file, { target: 'uos-v20', channel: 'store' });
    assert.equal(report.exitCode, 0);
    assert.equal(report.coverage.find((c) => c.ruleId === 'deb-control')?.status, 'unknown');
    assert.ok(!report.findings.some((f) => f.ruleId === 'deb-layout'));
  });
});
test('desktop parameters, placeholders, theme names, UTF-8 and broken references', async () => {
  for (const [exec, expected] of [
    ['app %U', 'info'],
    ['/opt/apps/com.example.app/files/missing %f', 'error'],
    ['/usr/bin/env app --no-sandbox', 'warning'],
  ] as const) {
    const entries = payload();
    entries[1] = {
      name: 'opt/apps/com.example.app/entries/applications/app.desktop',
      content: desktop
        .replace('"/opt/apps/com.example.app/files/app" %U', exec)
        .replace('Icon=com.example.app', 'Icon=system-theme-icon'),
    };
    await fixture(deb(entries), async (file) => {
      const report = await inspectDeb(file);
      assert.ok(report.findings.some((f) => f.ruleId === 'deb-desktop' && f.severity === expected));
      assert.ok(report.findings.some((f) => f.ruleId === 'deb-icon' && f.severity === 'info'));
    });
  }
  await fixture(deb([{ name: 'invalid.desktop', content: Buffer.from([0xff]) }]), async (file) =>
    assert.equal((await inspectDeb(file)).exitCode, 1),
  );
  await fixture(deb([{ name: 'duplicate.desktop', content: '[Desktop Entry]\nName=a\nName=b\n' }]), async (file) =>
    assert.equal((await inspectDeb(file)).exitCode, 1),
  );
});
test('Forge script paths, builder fpm hooks, sandbox and inherited config coverage', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'doctor-project-'));
  try {
    for (const config of [
      {
        build: {
          extends: './dynamic.cjs',
          linux: { target: 'deb' },
          deb: {
            fpm: ['--before-install=missing.sh'],
            desktop: { entry: { Exec: 'app --no-sandbox', Terminal: true } },
          },
        },
      },
      {
        config: {
          forge: {
            makers: [
              {
                name: '@electron-forge/maker-deb',
                config: {
                  options: {
                    name: 'com.example.app',
                    scripts: { preinst: 'missing.sh' },
                    desktopTemplate: 'missing.desktop',
                  },
                },
              },
            ],
          },
        },
      },
    ]) {
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'test', ...config }));
      const report = await runDoctor({ cwd: dir, target: 'uos-v20', channel: 'store' });
      assert.ok(report.findings.some((f) => f.ruleId === 'packaging-scripts' && f.title.includes('不存在')));
      assert.ok(report.findings.some((f) => f.ruleId === 'packaging-desktop' && f.severity === 'warning'));
      if ('build' in config) {
        assert.ok(report.findings.some((f) => f.ruleId === 'packaging-sandbox'));
        assert.equal(report.packaging?.coverage.find((c) => c.ruleId === 'packaging-name')?.status, 'unknown');
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('indirect directory-link cycles, file parents and signed-member presence remain untrusted', async () => {
  for (const entries of [
    [
      { name: 'a', type: '2', link: 'b/c' },
      { name: 'b', type: '2', link: 'a' },
    ],
    [{ name: 'a' }, { name: 'a/file' }],
  ])
    await fixture(deb(entries), async (file) => assert.equal((await inspectDeb(file)).exitCode, 2));
  const signed = ar([
    ['debian-binary', Buffer.from('2.0\n')],
    ['control.tar', tar([{ name: 'control', content: control }])],
    ['data.tar', tar(payload())],
    ['_gpgorigin', Buffer.from('not a verified signature')],
  ]);
  await fixture(signed, async (file) => {
    const report = await inspectDeb(file);
    assert.equal(report.exitCode, 0);
    assert.ok(report.findings.some((f) => f.ruleId === 'deb-container' && f.title.includes('未解释或验签')));
    assert.equal(report.coverage.find((c) => c.ruleId === 'deb-container')?.status, 'unknown');
  });
});
test('static Forge JSON cannot read configuration outside the project', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'doctor-boundary-'));
  const dir = path.join(parent, 'project');
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir);
    await writeFile(
      path.join(parent, 'outside.json'),
      JSON.stringify({ makers: [{ name: '@electron-forge/maker-deb' }] }),
    );
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'test', config: { forge: '../outside.json' } }),
    );
    const report = await runDoctor({ cwd: dir, target: 'uos-v20', channel: 'store' });
    assert.ok(report.findings.some((f) => f.ruleId === 'packaging-config'));
    assert.equal(report.packaging?.coverage.find((c) => c.ruleId === 'packaging-config')?.status, 'unknown');
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
