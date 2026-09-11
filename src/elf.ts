/**
 * 零依赖、只读的 ELF 读取器。只解析 doctor 需要的部分：
 * ELF 头（位宽、字节序、架构）、PT_INTERP（动态链接器路径，用于识别 musl）、
 * .dynamic 的 DT_NEEDED（依赖的共享库 SONAME）、.gnu.version_r（所需的符号版本，如 GLIBC_2.34）。
 *
 * 不执行、不写入、不跟随任何路径；输入只是一段 Buffer。
 */
import type { LinuxArch } from './data/electron-releases.ts';

export interface ElfInfo {
  /** 32 或 64 位。 */
  class: 32 | 64;
  endian: 'little' | 'big';
  /** e_machine 归一后的架构名；未知时为 null。 */
  arch: LinuxArch | null;
  /** 原始 e_machine 值，便于报告未知架构。 */
  machine: number;
  /** ET_DYN、ET_EXEC 等。 */
  type: number;
  /** PT_INTERP 指定的动态链接器路径；静态链接或共享库通常没有。 */
  interpreter: string | null;
  /** DT_NEEDED 列出的共享库。 */
  needed: string[];
  /** .gnu.version_r：每个库需要的符号版本，例如 { 'libc.so.6': ['GLIBC_2.2.5', 'GLIBC_2.34'] }。 */
  versionNeeds: Record<string, string[]>;
}

export class ElfParseError extends Error {}

const ELF_MAGIC = 0x7f454c46;
const PT_INTERP = 3;
const SHT_DYNAMIC = 6;
const SHT_GNU_VERNEED = 0x6ffffffe;
const DT_NULL = 0;
const DT_NEEDED = 1;

/** e_machine → 规范架构名。sw_64（申威）使用 0x9916。 */
const MACHINES: Record<number, (info: { class: 32 | 64; endian: 'little' | 'big' }) => LinuxArch | null> = {
  3: () => 'ia32',
  8: ({ class: cls, endian }) => (cls === 64 && endian === 'little' ? 'mips64el' : null),
  21: ({ class: cls, endian }) => (cls === 64 && endian === 'little' ? 'ppc64le' : null),
  22: ({ class: cls }) => (cls === 64 ? 's390x' : null),
  40: () => 'armv7l',
  62: () => 'x86_64',
  183: () => 'aarch64',
  243: ({ class: cls }) => (cls === 64 ? 'riscv64' : null),
  258: ({ class: cls }) => (cls === 64 ? 'loongarch64' : null),
  39190: () => 'sw_64',
};

export function isElf(buffer: Uint8Array): boolean {
  if (buffer.length < 4) return false;
  const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = buffer;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0 === ELF_MAGIC;
}

interface Reader {
  u16(offset: number): number;
  u32(offset: number): number;
  /** 64 位读取为 Number；文件偏移不会超过 2^53。 */
  u64(offset: number): number;
  /** 按位宽读取 Elf_Off / Elf_Addr / Elf_Xword。 */
  word(offset: number): number;
  wordSize: 4 | 8;
}

function createReader(buffer: Buffer, cls: 32 | 64, little: boolean): Reader {
  const u16 = little ? buffer.readUInt16LE.bind(buffer) : buffer.readUInt16BE.bind(buffer);
  const u32 = little ? buffer.readUInt32LE.bind(buffer) : buffer.readUInt32BE.bind(buffer);
  const u64 = (offset: number): number => {
    const value = little ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ElfParseError(`偏移 ${offset} 处的 64 位值超出可处理范围`);
    return Number(value);
  };
  return { u16, u32, u64, word: cls === 64 ? u64 : u32, wordSize: cls === 64 ? 8 : 4 };
}

function cString(buffer: Buffer, offset: number, limit: number): string {
  if (offset < 0 || offset >= limit) throw new ElfParseError(`字符串偏移 ${offset} 超出字符串表`);
  let end = offset;
  while (end < limit && buffer[end] !== 0) end += 1;
  return buffer.toString('utf8', offset, end);
}

interface Section {
  type: number;
  offset: number;
  size: number;
  link: number;
  entsize: number;
  info: number;
}

export function parseElf(input: Uint8Array): ElfInfo {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (!isElf(buffer)) throw new ElfParseError('不是 ELF 文件');
  if (buffer.length < 52) throw new ElfParseError('文件太短，不足以容纳 ELF 头');

  const cls = buffer[4] === 1 ? 32 : buffer[4] === 2 ? 64 : null;
  if (cls === null) throw new ElfParseError(`未知的 EI_CLASS ${buffer[4]}`);
  const little = buffer[5] === 1;
  if (!little && buffer[5] !== 2) throw new ElfParseError(`未知的 EI_DATA ${buffer[5]}`);
  const endian = little ? 'little' : 'big';
  const r = createReader(buffer, cls, little);

  const type = r.u16(16);
  const machine = r.u16(18);
  // e_phoff / e_shoff 的位置随位宽变化。
  const phoff = cls === 64 ? r.u64(32) : r.u32(28);
  const shoff = cls === 64 ? r.u64(40) : r.u32(32);
  const base = cls === 64 ? 54 : 42;
  const phentsize = r.u16(base);
  const phnum = r.u16(base + 2);
  const shentsize = r.u16(base + 4);
  const shnum = r.u16(base + 6);

  const info: ElfInfo = {
    class: cls,
    endian,
    arch: MACHINES[machine]?.({ class: cls, endian }) ?? null,
    machine,
    type,
    interpreter: null,
    needed: [],
    versionNeeds: {},
  };

  // 程序头：只找 PT_INTERP。
  for (let i = 0; i < phnum; i += 1) {
    const ph = phoff + i * phentsize;
    if (ph + phentsize > buffer.length) break;
    if (r.u32(ph) !== PT_INTERP) continue;
    const offset = cls === 64 ? r.u64(ph + 8) : r.u32(ph + 4);
    const size = cls === 64 ? r.u64(ph + 32) : r.u32(ph + 16);
    if (offset + size <= buffer.length) info.interpreter = cString(buffer, offset, offset + size);
    break;
  }

  // 节头。
  const sections: Section[] = [];
  for (let i = 0; i < shnum; i += 1) {
    const sh = shoff + i * shentsize;
    if (sh + shentsize > buffer.length) break;
    const wordAt = (n: number): number => r.word(sh + n);
    sections.push(
      cls === 64
        ? {
            type: r.u32(sh + 4),
            offset: wordAt(24),
            size: wordAt(32),
            link: r.u32(sh + 40),
            info: r.u32(sh + 44),
            entsize: wordAt(56),
          }
        : {
            type: r.u32(sh + 4),
            offset: r.u32(sh + 16),
            size: r.u32(sh + 20),
            link: r.u32(sh + 24),
            info: r.u32(sh + 28),
            entsize: r.u32(sh + 36),
          },
    );
  }

  const strtabOf = (section: Section): { start: number; end: number } | null => {
    const table = sections[section.link];
    if (!table || table.offset + table.size > buffer.length) return null;
    return { start: table.offset, end: table.offset + table.size };
  };

  for (const section of sections) {
    if (section.type === SHT_DYNAMIC) {
      const strtab = strtabOf(section);
      if (!strtab) continue;
      const entsize = section.entsize || r.wordSize * 2;
      for (
        let p = section.offset;
        p + entsize <= section.offset + section.size && p + entsize <= buffer.length;
        p += entsize
      ) {
        const tag = r.word(p);
        if (tag === DT_NULL) break;
        if (tag === DT_NEEDED) info.needed.push(cString(buffer, strtab.start + r.word(p + r.wordSize), strtab.end));
      }
    } else if (section.type === SHT_GNU_VERNEED) {
      const strtab = strtabOf(section);
      if (!strtab) continue;
      let p = section.offset;
      for (let n = 0; n < section.info && p + 16 <= buffer.length; n += 1) {
        const count = r.u16(p + 2);
        const file = cString(buffer, strtab.start + r.u32(p + 4), strtab.end);
        const aux = r.u32(p + 8);
        const next = r.u32(p + 12);
        const versions = info.versionNeeds[file] ?? [];
        let q = p + aux;
        for (let k = 0; k < count && q + 16 <= buffer.length; k += 1) {
          versions.push(cString(buffer, strtab.start + r.u32(q + 8), strtab.end));
          const auxNext = r.u32(q + 12);
          if (auxNext === 0) break;
          q += auxNext;
        }
        info.versionNeeds[file] = versions;
        if (next === 0) break;
        p += next;
      }
    }
  }

  return info;
}

/** 动态链接器路径是否指向 musl。 */
export function isMuslInterpreter(interpreter: string | null): boolean {
  return interpreter !== null && /ld-musl-/.test(interpreter);
}

/** 从 versionNeeds 中取某个版本前缀（如 GLIBC）的最高版本，例如 'GLIBC_2.34' → '2.34'。 */
export function highestSymbolVersion(info: ElfInfo, prefix: 'GLIBC' | 'GLIBCXX' | 'CXXABI' | 'GCC'): string | null {
  let best: string | null = null;
  for (const versions of Object.values(info.versionNeeds)) {
    for (const version of versions) {
      if (!version.startsWith(`${prefix}_`)) continue;
      const number = version.slice(prefix.length + 1);
      if (!/^\d+(\.\d+)*$/.test(number)) continue;
      if (best === null || compareVersions(number, best) > 0) best = number;
    }
  }
  return best;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
