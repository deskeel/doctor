// Development-only: run with Node 22 type stripping. Never executes the fixture contents.
import { writeFile } from 'node:fs/promises';
import { deb, payload } from '../test/helpers/deb.ts';

const root = new URL('../test/fixtures/deb/', import.meta.url);
await writeFile(new URL('com.example.app_1.2.3_amd64.deb', root), deb());
await writeFile(new URL('kylin.deb', root), deb(payload(false), undefined, ''));
await writeFile(new URL('unsafe.deb', root), deb([{ name: '../escape' }]));
