import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareVersions,
  ElfParseError,
  highestSymbolVersion,
  isElf,
  isMuslInterpreter,
  parseElf,
} from '../src/elf.ts';
import { buildElf } from './helpers/elf-builder.ts';

test('parses a 64-bit little-endian x86_64 shared object', () => {
  const elf = buildElf({
    needed: ['libc.so.6', 'libstdc++.so.6', 'libpthread.so.0'],
    versionNeeds: {
      'libc.so.6': ['GLIBC_2.2.5', 'GLIBC_2.34', 'GLIBC_2.14'],
      'libstdc++.so.6': ['GLIBCXX_3.4.21', 'CXXABI_1.3.9', 'GLIBCXX_3.4.29'],
    },
  });
  assert.ok(isElf(elf));
  const info = parseElf(elf);
  assert.equal(info.class, 64);
  assert.equal(info.endian, 'little');
  assert.equal(info.arch, 'x86_64');
  assert.equal(info.interpreter, '/lib64/ld-linux-x86-64.so.2');
  assert.deepEqual(info.needed, ['libc.so.6', 'libstdc++.so.6', 'libpthread.so.0']);
  assert.deepEqual(info.versionNeeds['libc.so.6'], ['GLIBC_2.2.5', 'GLIBC_2.34', 'GLIBC_2.14']);
  assert.equal(highestSymbolVersion(info, 'GLIBC'), '2.34');
  assert.equal(highestSymbolVersion(info, 'GLIBCXX'), '3.4.29');
  assert.equal(highestSymbolVersion(info, 'CXXABI'), '1.3.9');
  assert.equal(highestSymbolVersion(info, 'GCC'), null);
  assert.equal(isMuslInterpreter(info.interpreter), false);
});

test('parses a 32-bit big-endian object and recognises other machines', () => {
  const info = parseElf(
    buildElf({ class: 32, endian: 'big', machine: 40, interpreter: '/lib/ld-linux-armhf.so.3', needed: ['libc.so.6'] }),
  );
  assert.equal(info.class, 32);
  assert.equal(info.endian, 'big');
  assert.equal(info.arch, 'armv7l');
  assert.equal(info.interpreter, '/lib/ld-linux-armhf.so.3');
  assert.deepEqual(info.needed, ['libc.so.6']);

  assert.equal(parseElf(buildElf({ machine: 183 })).arch, 'aarch64');
  assert.equal(parseElf(buildElf({ machine: 258 })).arch, 'loongarch64');
  assert.equal(parseElf(buildElf({ machine: 243 })).arch, 'riscv64');
  assert.equal(parseElf(buildElf({ machine: 0x9916 })).arch, 'sw_64');
  assert.equal(parseElf(buildElf({ machine: 8 })).arch, 'mips64el');
  assert.equal(parseElf(buildElf({ machine: 8, class: 32 })).arch, null);
  assert.equal(parseElf(buildElf({ machine: 9999 })).arch, null);
});

test('detects musl interpreters and objects without PT_INTERP', () => {
  const musl = parseElf(buildElf({ interpreter: '/lib/ld-musl-x86_64.so.1' }));
  assert.equal(isMuslInterpreter(musl.interpreter), true);
  const none = parseElf(buildElf({ interpreter: null }));
  assert.equal(none.interpreter, null);
  assert.equal(isMuslInterpreter(none.interpreter), false);
});

test('rejects non-ELF and truncated input', () => {
  assert.equal(isElf(Buffer.from('MZ')), false);
  assert.throws(() => parseElf(Buffer.from('not an elf file at all')), ElfParseError);
  assert.throws(() => parseElf(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1])), ElfParseError);
  assert.throws(
    () => parseElf(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 9, 1, 1, ...new Array(60).fill(0)])),
    ElfParseError,
  );
});

test('does not read past the buffer when section headers point outside it', () => {
  const elf = buildElf({ needed: ['libc.so.6'], versionNeeds: { 'libc.so.6': ['GLIBC_2.34'] } });
  const truncated = elf.subarray(0, 96);
  const info = parseElf(truncated);
  assert.equal(info.arch, 'x86_64');
  assert.deepEqual(info.needed, []);
  assert.deepEqual(info.versionNeeds, {});
});

test('compareVersions orders dotted versions numerically', () => {
  assert.ok(compareVersions('2.34', '2.4') > 0);
  assert.ok(compareVersions('2.2.5', '2.14') < 0);
  assert.equal(compareVersions('3.4.29', '3.4.29'), 0);
});
