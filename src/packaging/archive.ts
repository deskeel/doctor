import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

export interface ArchiveLimits {
  inputBytes: number;
  expandedBytes: number;
  entryBytes: number;
  entries: number;
  arMembers: number;
  timeoutMs: number;
}
export const DEFAULT_LIMITS: ArchiveLimits = {
  inputBytes: 512 * 1024 ** 2,
  expandedBytes: 1024 * 1024 ** 2,
  entryBytes: 256 * 1024 ** 2,
  entries: 100000,
  arMembers: 32,
  timeoutMs: 30000,
};
export interface TarEntry {
  name: string;
  type: string;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  link?: string;
  data: Buffer;
}
export function archiveLimits(overrides: Partial<ArchiveLimits> = {}): ArchiveLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value <= 0 || value > DEFAULT_LIMITS[key as keyof ArchiveLimits])
      throw new Error(`无效资源上限 ${key}`);
  return limits;
}
export async function readBounded(file: string, limit: number, timeoutMs = 30000): Promise<Buffer> {
  // O_NONBLOCK prevents a FIFO from hanging before fstat can reject it.
  const handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('输入必须是本地普通文件');
    if (stat.size > limit) throw new Error('输入体积超限');
    const stream = handle.createReadStream({ autoClose: false });
    const timer = setTimeout(() => stream.destroy(new Error('输入读取超时')), timeoutMs);
    try {
      return await collect(stream, limit);
    } finally {
      clearTimeout(timer);
      stream.destroy();
    }
  } finally {
    await handle.close();
  }
}
export function parseAr(buffer: Buffer, limits: ArchiveLimits): Map<string, Buffer> {
  if (buffer.subarray(0, 8).toString() !== '!<arch>\n') throw new Error('不是 ar / DEB 容器');
  const members = new Map<string, Buffer>();
  let offset = 8;
  while (offset < buffer.length) {
    if (members.size >= limits.arMembers) throw new Error('ar 成员数超限');
    const h = buffer.subarray(offset, offset + 60);
    if (h.length !== 60 || h.subarray(58).toString() !== '`\n') throw new Error('ar 头截断或损坏');
    const name = h.subarray(0, 16).toString().trim().replace(/\/$/, '');
    const rawSize = h.subarray(48, 58).toString().trim();
    if (!/^[0-9]+$/.test(rawSize) || !/^[a-zA-Z0-9_.+-]+$/.test(name)) throw new Error('不支持或损坏的 ar 成员');
    const size = Number(rawSize);
    offset += 60;
    if (!Number.isSafeInteger(size) || size > limits.inputBytes || offset + size > buffer.length)
      throw new Error('ar 成员截断或超限');
    if (members.has(name)) throw new Error(`重复 ar 成员 ${name}`);
    members.set(name, buffer.subarray(offset, offset + size));
    offset += size;
    if (size % 2) {
      if (buffer[offset] !== 10) throw new Error('ar 对齐损坏');
      offset++;
    }
  }
  const names = [...members.keys()];
  if (names[0] !== 'debian-binary' || members.get('debian-binary')?.toString() !== '2.0\n')
    throw new Error('debian-binary 缺失、顺序错误或版本不支持');
  for (const part of ['control', 'data'])
    if (names.filter((n) => n.startsWith(`${part}.tar`)).length !== 1) throw new Error(`${part}.tar 缺失或歧义`);
  if (!names[1]?.startsWith('control.tar') || !names[2]?.startsWith('data.tar')) throw new Error('DEB 成员顺序错误');
  return members;
}
// Inspect tar headers as bytes arrive, before retaining an oversized entry or too many entries.
function tarBudget(limits: ArchiveLimits): (chunk: Buffer) => void {
  let pending = Buffer.alloc(0);
  let skip = 0;
  let count = 0;
  let ended = false;
  return (chunk) => {
    let at = 0;
    while (at < chunk.length && !ended) {
      if (skip) {
        const n = Math.min(skip, chunk.length - at);
        skip -= n;
        at += n;
        continue;
      }
      const n = Math.min(512 - pending.length, chunk.length - at);
      pending = Buffer.concat([pending, chunk.subarray(at, at + n)]);
      at += n;
      if (pending.length !== 512) continue;
      if (pending.every((b) => b === 0)) {
        ended = true;
        return;
      }
      if (++count > limits.entries) throw new Error('tar 条目数超限（解压过程中）');
      const size = octal(pending, 124, 12);
      if (size > limits.entryBytes) throw new Error('单条目体积超限（解压过程中）');
      skip = Math.ceil(size / 512) * 512;
      pending = Buffer.alloc(0);
    }
  };
}
async function collect(
  stream: AsyncIterable<Buffer>,
  limit: number,
  observe?: (chunk: Buffer) => void,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error('解压总量超限');
    observe?.(chunk);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function decompress(
  name: string,
  data: Buffer,
  limit: number,
  timeoutMs: number,
  limits: ArchiveLimits = DEFAULT_LIMITS,
): Promise<Buffer> {
  if (name.endsWith('.tar')) {
    if (data.length > limit) throw new Error('解压总量超限');
    return data;
  }
  if (name.endsWith('.tar.gz')) {
    const unzip = createGunzip();
    const timer = setTimeout(() => unzip.destroy(new Error('gzip 解压超时')), timeoutMs);
    try {
      Readable.from([data]).pipe(unzip);
      return await collect(unzip, limit, tarBudget(limits));
    } finally {
      clearTimeout(timer);
      unzip.destroy();
    }
  }
  const tool = name.endsWith('.tar.xz') ? 'xz' : name.endsWith('.tar.zst') ? 'zstd' : null;
  if (!tool) throw new Error(`不支持压缩格式 ${name}`);
  // Only fixed executables and flags; archive bytes go through stdin, never a shell or filename argument.
  const child = spawn(
    tool,
    tool === 'xz'
      ? ['--decompress', '--stdout', '--memlimit-decompress=256MiB']
      : ['--decompress', '--stdout', '--memory=256MB'],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, XZ_OPT: '', XZ_DEFAULTS: '', ZSTD_NBTHREADS: '1' } },
  );
  let stderr = '';
  child.stderr.on('data', (b) => {
    if (stderr.length < 4096) stderr += String(b).slice(0, 4096 - stderr.length);
  });
  child.stdin.on('error', () => {});
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (e) => reject(new Error(`${tool} 无法使用：${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${tool} 解压失败 ${code}: ${stderr}`))));
  });
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    child.stdout.destroy(new Error(`${tool} 解压超时`));
  }, timeoutMs);
  try {
    child.stdin.end(data);
    const [output] = await Promise.all([collect(child.stdout, limit, tarBudget(limits)), done]);
    return output;
  } finally {
    clearTimeout(timer);
    child.kill('SIGKILL');
  }
}
function field(b: Buffer, start: number, length: number): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(start, start + length)).split('\0')[0] ?? '';
}
function octal(b: Buffer, start: number, length: number): number {
  const value = field(b, start, length).trim();
  if (!/^[0-7]*$/.test(value)) throw new Error('不支持 tar base-256 或无效数字');
  const n = Number.parseInt(value || '0', 8);
  if (!Number.isSafeInteger(n)) throw new Error('tar 数字溢出');
  return n;
}
export function safePath(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject control characters in untrusted tar paths
  if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || /[\u0000-\u001f]/u.test(name))
    throw new Error(`不安全归档路径 ${JSON.stringify(name)}`);
  if (!name || /^[A-Za-z]:/.test(name)) throw new Error('空路径或 Windows 绝对路径不受支持');
  return path.posix.normalize(name).replace(/^\.\//, '').replace(/\/$/, '');
}
export function parseTar(buffer: Buffer, limits: ArchiveLimits): Map<string, TarEntry> {
  const entries = new Map<string, TarEntry>();
  let offset = 0;
  let count = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) {
      if (buffer.length % 512 !== 0 || buffer.length - offset < 1024 || !buffer.subarray(offset).every((b) => b === 0))
        throw new Error('tar 结束块截断或尾随数据');
      return entries;
    }
    if (++count > limits.entries) throw new Error('tar 条目数超限');
    const checksum = header.reduce((sum, b, i) => sum + (i >= 148 && i < 156 ? 32 : b), 0);
    if (checksum !== octal(header, 148, 8)) throw new Error('tar 校验和错误');
    const magic = field(header, 257, 6);
    if (magic && magic !== 'ustar' && magic !== 'ustar ') throw new Error('不支持 tar 格式');
    const prefix = magic === 'ustar' ? field(header, 345, 155) : '';
    const name = safePath(`${prefix ? `${prefix}/` : ''}${field(header, 0, 100)}`);
    const type = field(header, 156, 1) || '0';
    if (name === '.' && type !== '5') throw new Error('tar 根条目必须是目录');
    if (!['0', '1', '2', '5'].includes(type))
      throw new Error(`不支持 tar 类型 ${type} (${name})；PAX/GNU 扩展与特殊设备未检查`);
    const size = octal(header, 124, 12);
    if (size > limits.entryBytes) throw new Error(`单条目体积超限 ${name}`);
    if (type !== '0' && size !== 0) throw new Error(`非文件条目含数据 ${name}`);
    offset += 512;
    const end = offset + Math.ceil(size / 512) * 512;
    if (end > buffer.length) throw new Error(`tar 条目截断 ${name}`);
    if (entries.has(name)) throw new Error(`重复 tar 条目 ${name}`);
    const link = ['1', '2'].includes(type) ? field(header, 157, 100) : undefined;
    if (link !== undefined) {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: reject control characters in untrusted tar links
      if (!link || link.includes('\\') || /[\u0000-\u001f]/u.test(link)) throw new Error(`无效链接 ${name}`);
      const resolved = path.posix.normalize(
        link.startsWith('/') ? link.slice(1) : type === '1' ? link : path.posix.join(path.posix.dirname(name), link),
      );
      if (resolved === '..' || resolved.startsWith('../')) throw new Error(`链接越界 ${name}`);
    }
    entries.set(name, {
      name,
      type,
      mode: octal(header, 100, 8),
      uid: octal(header, 108, 8),
      gid: octal(header, 116, 8),
      size,
      link,
      data: buffer.subarray(offset, offset + size),
    });
    offset = end;
  }
  throw new Error('tar 缺少结束块');
}
export function resolveEntry(entries: Map<string, TarEntry>, name: string): TarEntry | undefined {
  let current = path.posix.normalize(name.replace(/^\/+/, ''));
  const seen = new Set<string>();
  for (let depth = 0; depth < 128; depth++) {
    if (current === '..' || current.startsWith('../') || current.startsWith('/')) throw new Error(`链接越界 ${name}`);
    if (seen.has(current)) throw new Error(`链接循环 ${name}`);
    seen.add(current);
    const parts = current.split('/');
    let rewritten = false;
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts.slice(0, i + 1).join('/');
      const entry = entries.get(prefix);
      if (entry?.link !== undefined) {
        const target = entry.link.startsWith('/')
          ? entry.link.replace(/^\/+/, '')
          : entry.type === '1'
            ? entry.link
            : path.posix.join(path.posix.dirname(prefix), entry.link);
        current = path.posix.normalize(path.posix.join(target, ...parts.slice(i + 1)));
        rewritten = true;
        break;
      }
      if (entry && i < parts.length - 1 && entry.type !== '5') throw new Error(`非目录条目包含子路径 ${prefix}`);
    }
    if (!rewritten) return entries.get(current);
  }
  throw new Error(`链接深度超限 ${name}`);
}
