#!/usr/bin/env node
import { parseArgs } from 'node:util';
import pkg from '../package.json' with { type: 'json' };
import { runDoctor } from './engine.ts';
import { renderJson } from './report/json.ts';
import { renderText } from './report/text.ts';

const HELP = `用法：deskkeel-doctor [目录] [选项]

检查 Electron 工程能否交付到统信 UOS、银河麒麟。只读取工程文件和已安装的 node_modules，不上传源码。

选项：
  --json        输出 JSON 报告
  --cwd <目录>  要检查的工程目录，等同于位置参数
  --no-color    关闭颜色
  -h, --help    显示帮助
  -v, --version 显示版本

退出码：0 没有错误级问题；1 存在错误级问题；2 doctor 自身运行失败。
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      cwd: { type: 'string' },
      'no-color': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (positionals.length > 1) {
    process.stderr.write('最多只能指定一个目录。\n');
    return 2;
  }

  const report = await runDoctor({ cwd: values.cwd ?? positionals[0] });
  const color = !values.json && !values['no-color'] && !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
  process.stdout.write(values.json ? `${renderJson(report)}\n` : renderText(report, { color }));
  return report.exitCode;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`doctor 运行失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  },
);
