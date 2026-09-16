#!/usr/bin/env node
import { parseArgs } from 'node:util';
import pkg from '../package.json' with { type: 'json' };
import { runDoctor } from './engine.ts';
import { inspectDeb, renderInspectText } from './packaging/inspect.ts';
import { type PackagingOptions, validatePackagingOptions } from './packaging/profile.ts';
import { renderJson } from './report/json.ts';
import { renderText } from './report/text.ts';

const HELP = `用法：deskkeel-doctor [目录] [选项]
      deskkeel-doctor inspect <文件.deb> [选项]

检查 Electron 工程能否交付到统信 UOS、银河麒麟。只读取工程文件和已安装的 node_modules，不上传源码。

选项：
  --target <目标>  uos-v20 | kylin-v10（可选，不猜测渠道）
  --channel <渠道> store | direct | enterprise（必须同时指定 target）
  --json        输出 JSON 报告
  --cwd <目录>  要检查的工程目录，等同于位置参数
  --no-color    关闭颜色
  -h, --help    显示帮助
  -v, --version 显示版本

退出码：0 没有错误级问题；1 存在错误级问题；2 用法错误、解析/覆盖未完成或 doctor 自身运行失败。
inspect 只读，不安装、执行脚本、落盘解包或验签。未知运行项不代表通过。
压缩支持：tar/gzip 内置，xz/zstd 需本机工具；不支持的压缩或 tar 扩展退出 2。
默认上限：输入 512 MiB、展开 1 GiB、单条目 256 MiB、100000 条目、每流 30 秒。
检查名为 inspect 的工程目录请使用 ./inspect 或 --cwd inspect。
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      cwd: { type: 'string' },
      target: { type: 'string' },
      channel: { type: 'string' },
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
  const packaging = { target: values.target, channel: values.channel } as PackagingOptions;
  validatePackagingOptions(packaging);
  if (positionals[0] === 'inspect') {
    if (positionals.length !== 2 || values.cwd) throw new Error('inspect 必须指定一个 DEB 文件，不能使用 --cwd');
    const report = await inspectDeb(positionals[1] as string, packaging);
    process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : renderInspectText(report));
    return report.exitCode;
  }
  if (positionals.length > 1) {
    process.stderr.write('最多只能指定一个目录。\n');
    return 2;
  }

  const report = await runDoctor({ cwd: values.cwd ?? positionals[0], ...packaging });
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
