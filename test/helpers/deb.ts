import { gzipSync } from 'node:zlib';

interface Entry {
  name: string;
  content?: string | Buffer;
  mode?: number;
  uid?: number;
  type?: string;
  link?: string;
}
export function tar(entries: Entry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const content = Buffer.from(e.content ?? '');
    const h = Buffer.alloc(512);
    const oct = (offset: number, size: number, value: number) =>
      h.write(`${value.toString(8).padStart(size - 1, '0')}\0`, offset, size, 'ascii');
    h.write(e.name, 0, 100);
    oct(100, 8, e.mode ?? 0o644);
    oct(108, 8, e.uid ?? 0);
    oct(116, 8, 0);
    oct(124, 12, content.length);
    oct(136, 12, 0);
    h.fill(32, 148, 156);
    h.write(e.type ?? '0', 156, 1);
    h.write(e.link ?? '', 157, 100);
    h.write('ustar\0', 257, 6);
    h.write('00', 263, 2);
    oct(
      148,
      8,
      h.reduce((sum, n) => sum + n, 0),
    );
    blocks.push(h, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}
export function ar(entries: [string, Buffer][]): Buffer {
  return Buffer.concat([
    Buffer.from('!<arch>\n'),
    ...entries.flatMap(([name, b]) => [
      Buffer.from(
        `${name.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'100644'.padEnd(8)}${String(b.length).padEnd(10)}\x60\n`,
      ),
      b,
      ...(b.length % 2 ? [Buffer.from('\n')] : []),
    ]),
  ]);
}
export const control =
  'Package: com.example.app\nVersion: 1.2.3\nArchitecture: amd64\nMaintainer: Test <test@example.org>\nDescription: Synthetic test\n';
export const desktop =
  '[Desktop Entry]\nName=Test\nName[zh_CN]=测试\nExec="/opt/apps/com.example.app/files/app" %U\nIcon=com.example.app\nType=Application\nTerminal=false\nStartupNotify=true\n';
export function payload(uos = true): Entry[] {
  return [
    { name: './opt/apps/com.example.app/files/app', content: 'never executed', mode: 0o755 },
    {
      name: uos ? 'opt/apps/com.example.app/entries/applications/app.desktop' : 'usr/share/applications/app.desktop',
      content: desktop,
    },
    {
      name: uos
        ? 'opt/apps/com.example.app/entries/icons/hicolor/48x48/apps/com.example.app.png'
        : 'usr/share/icons/hicolor/48x48/apps/com.example.app.png',
      content: 'not decoded',
    },
    {
      name: 'opt/apps/com.example.app/info',
      content: JSON.stringify({ appid: 'com.example.app', version: '1.2.3', arch: ['amd64'], permissions: {} }),
    },
  ];
}
export function deb(
  data = payload(),
  ctrl: Entry[] = [{ name: './control', content: control }],
  compression = 'gz',
): Buffer {
  const compress = (b: Buffer) => (compression === 'gz' ? gzipSync(b) : b);
  return ar([
    ['debian-binary', Buffer.from('2.0\n')],
    [`control.tar${compression ? `.${compression}` : ''}`, compress(tar(ctrl))],
    [`data.tar${compression ? `.${compression}` : ''}`, compress(tar(data))],
  ]);
}
