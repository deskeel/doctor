/**
 * 构造最小可解析的 ELF 文件，用于测试 ELF 读取器和原生模块扫描。
 * 生成的文件不可执行，只包含 ELF 头、一个 PT_INTERP 程序头、
 * .dynstr、.dynamic、.gnu.version_r 与 .shstrtab 五个节。
 */
export interface ElfSpec {
  class?: 32 | 64;
  endian?: 'little' | 'big';
  machine?: number;
  interpreter?: string | null;
  needed?: string[];
  /** 每个库需要的符号版本，例如 { 'libc.so.6': ['GLIBC_2.2.5', 'GLIBC_2.34'] }。 */
  versionNeeds?: Record<string, string[]>;
}

class StringTable {
  readonly bytes: number[] = [0];
  private readonly offsets = new Map<string, number>();
  offset(value: string): number {
    const known = this.offsets.get(value);
    if (known !== undefined) return known;
    const offset = this.bytes.length;
    this.bytes.push(...Buffer.from(value, 'utf8'), 0);
    this.offsets.set(value, offset);
    return offset;
  }
}

export function buildElf(spec: ElfSpec = {}): Buffer {
  const cls = spec.class ?? 64;
  const little = (spec.endian ?? 'little') === 'little';
  const machine = spec.machine ?? 62;
  const interpreter = spec.interpreter === undefined ? '/lib64/ld-linux-x86-64.so.2' : spec.interpreter;
  const needed = spec.needed ?? ['libc.so.6'];
  const versionNeeds = spec.versionNeeds ?? {};
  const wordSize = cls === 64 ? 8 : 4;

  const dynstr = new StringTable();
  for (const lib of needed) dynstr.offset(lib);
  for (const [lib, versions] of Object.entries(versionNeeds)) {
    dynstr.offset(lib);
    for (const version of versions) dynstr.offset(version);
  }
  const shstr = new StringTable();
  const [nameDynstr, nameDynamic, nameVerneed, nameShstrtab] = [
    '.dynstr',
    '.dynamic',
    '.gnu.version_r',
    '.shstrtab',
  ].map((name) => shstr.offset(name)) as [number, number, number, number];

  // .dynamic：DT_NEEDED 若干 + DT_NULL。
  const dynamic = Buffer.alloc((needed.length + 1) * wordSize * 2);
  const writeWord = (buf: Buffer, offset: number, value: number): void => {
    if (cls === 64) little ? buf.writeBigUInt64LE(BigInt(value), offset) : buf.writeBigUInt64BE(BigInt(value), offset);
    else little ? buf.writeUInt32LE(value, offset) : buf.writeUInt32BE(value, offset);
  };
  const w16 = (buf: Buffer, offset: number, value: number): void => {
    little ? buf.writeUInt16LE(value, offset) : buf.writeUInt16BE(value, offset);
  };
  const w32 = (buf: Buffer, offset: number, value: number): void => {
    little ? buf.writeUInt32LE(value, offset) : buf.writeUInt32BE(value, offset);
  };
  needed.forEach((lib, i) => {
    writeWord(dynamic, i * wordSize * 2, 1);
    writeWord(dynamic, i * wordSize * 2 + wordSize, dynstr.offset(lib));
  });

  // .gnu.version_r：Verneed(16 字节) + Vernaux(16 字节) * n。
  const verneedEntries = Object.entries(versionNeeds);
  const verneedSize = verneedEntries.reduce((sum, [, versions]) => sum + 16 + versions.length * 16, 0);
  const verneed = Buffer.alloc(verneedSize);
  let vp = 0;
  verneedEntries.forEach(([lib, versions], index) => {
    w16(verneed, vp, 1);
    w16(verneed, vp + 2, versions.length);
    w32(verneed, vp + 4, dynstr.offset(lib));
    w32(verneed, vp + 8, 16);
    w32(verneed, vp + 12, index === verneedEntries.length - 1 ? 0 : 16 + versions.length * 16);
    let ap = vp + 16;
    versions.forEach((version, k) => {
      w32(verneed, ap, 0);
      w16(verneed, ap + 4, 0);
      w16(verneed, ap + 6, 2 + k);
      w32(verneed, ap + 8, dynstr.offset(version));
      w32(verneed, ap + 12, k === versions.length - 1 ? 0 : 16);
      ap += 16;
    });
    vp = ap;
  });

  const interp = interpreter === null ? Buffer.alloc(0) : Buffer.from(`${interpreter}\0`, 'utf8');
  const dynstrBuf = Buffer.from(dynstr.bytes);
  const shstrBuf = Buffer.from(shstr.bytes);

  const ehsize = cls === 64 ? 64 : 52;
  const phentsize = cls === 64 ? 56 : 32;
  const shentsize = cls === 64 ? 64 : 40;
  const phnum = interpreter === null ? 0 : 1;

  // 布局：ELF 头 | 程序头 | interp | dynstr | dynamic | verneed | shstrtab | 节头表。
  let cursor = ehsize + phentsize * phnum;
  const place = (buf: Buffer): number => {
    const offset = cursor;
    cursor += buf.length;
    cursor = (cursor + 7) & ~7;
    return offset;
  };
  const interpOff = place(interp);
  const dynstrOff = place(dynstrBuf);
  const dynamicOff = place(dynamic);
  const verneedOff = place(verneed);
  const shstrOff = place(shstrBuf);
  const shoff = cursor;
  const shnum = 5;
  const out = Buffer.alloc(shoff + shentsize * shnum);

  // ELF 头。
  out.writeUInt32BE(0x7f454c46, 0);
  out[4] = cls === 64 ? 2 : 1;
  out[5] = little ? 1 : 2;
  out[6] = 1;
  w16(out, 16, 3); // ET_DYN
  w16(out, 18, machine);
  w32(out, 20, 1);
  if (cls === 64) {
    writeWord(out, 24, 0);
    writeWord(out, 32, phnum ? ehsize : 0);
    writeWord(out, 40, shoff);
    w32(out, 48, 0);
    w16(out, 52, ehsize);
    w16(out, 54, phentsize);
    w16(out, 56, phnum);
    w16(out, 58, shentsize);
    w16(out, 60, shnum);
    w16(out, 62, 4);
  } else {
    w32(out, 24, 0);
    w32(out, 28, phnum ? ehsize : 0);
    w32(out, 32, shoff);
    w32(out, 36, 0);
    w16(out, 40, ehsize);
    w16(out, 42, phentsize);
    w16(out, 44, phnum);
    w16(out, 46, shentsize);
    w16(out, 48, shnum);
    w16(out, 50, 4);
  }

  // PT_INTERP。
  if (phnum) {
    const ph = ehsize;
    w32(out, ph, 3);
    if (cls === 64) {
      w32(out, ph + 4, 4);
      writeWord(out, ph + 8, interpOff);
      writeWord(out, ph + 16, interpOff);
      writeWord(out, ph + 24, interpOff);
      writeWord(out, ph + 32, interp.length);
      writeWord(out, ph + 40, interp.length);
      writeWord(out, ph + 48, 1);
    } else {
      w32(out, ph + 4, interpOff);
      w32(out, ph + 8, interpOff);
      w32(out, ph + 12, interpOff);
      w32(out, ph + 16, interp.length);
      w32(out, ph + 20, interp.length);
      w32(out, ph + 24, 4);
      w32(out, ph + 28, 1);
    }
  }

  interp.copy(out, interpOff);
  dynstrBuf.copy(out, dynstrOff);
  dynamic.copy(out, dynamicOff);
  verneed.copy(out, verneedOff);
  shstrBuf.copy(out, shstrOff);

  // 节头：0 空节，1 .dynstr，2 .dynamic，3 .gnu.version_r，4 .shstrtab。
  const writeSection = (
    index: number,
    fields: { name: number; type: number; offset: number; size: number; link: number; info: number; entsize: number },
  ): void => {
    const sh = shoff + index * shentsize;
    w32(out, sh, fields.name);
    w32(out, sh + 4, fields.type);
    if (cls === 64) {
      writeWord(out, sh + 8, 0);
      writeWord(out, sh + 16, 0);
      writeWord(out, sh + 24, fields.offset);
      writeWord(out, sh + 32, fields.size);
      w32(out, sh + 40, fields.link);
      w32(out, sh + 44, fields.info);
      writeWord(out, sh + 48, 1);
      writeWord(out, sh + 56, fields.entsize);
    } else {
      w32(out, sh + 8, 0);
      w32(out, sh + 12, 0);
      w32(out, sh + 16, fields.offset);
      w32(out, sh + 20, fields.size);
      w32(out, sh + 24, fields.link);
      w32(out, sh + 28, fields.info);
      w32(out, sh + 32, 1);
      w32(out, sh + 36, fields.entsize);
    }
  };
  writeSection(1, {
    name: nameDynstr,
    type: 3,
    offset: dynstrOff,
    size: dynstrBuf.length,
    link: 0,
    info: 0,
    entsize: 0,
  });
  writeSection(2, {
    name: nameDynamic,
    type: 6,
    offset: dynamicOff,
    size: dynamic.length,
    link: 1,
    info: 0,
    entsize: wordSize * 2,
  });
  writeSection(3, {
    name: nameVerneed,
    type: 0x6ffffffe,
    offset: verneedOff,
    size: verneed.length,
    link: 1,
    info: verneedEntries.length,
    entsize: 0,
  });
  writeSection(4, {
    name: nameShstrtab,
    type: 3,
    offset: shstrOff,
    size: shstrBuf.length,
    link: 0,
    info: 0,
    entsize: 0,
  });

  return out;
}
