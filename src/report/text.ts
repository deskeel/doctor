import type { DoctorReport, Finding, Severity } from '../types.ts';

export interface TextOptions {
  color?: boolean;
}

const ESC = `${String.fromCharCode(27)}[`;
const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const SYMBOL: Record<Severity, string> = { error: '✖', warning: '⚠', info: 'ℹ' };
const ANSI: Record<Severity, string> = { error: '31', warning: '33', info: '36' };

export function renderText(report: DoctorReport, options: TextOptions = {}): string {
  const paint = (severity: Severity, text: string): string =>
    options.color ? `${ESC}${ANSI[severity]}m${text}${ESC}0m` : text;
  const dim = (text: string): string => (options.color ? `${ESC}2m${text}${ESC}0m` : text);

  const lines: string[] = [];
  lines.push(`DeskKeel Doctor v${report.doctorVersion}`);
  lines.push(`目录：${report.cwd}`);
  const { project } = report;
  if (project.name) lines.push(`工程：${project.name}${project.version ? ` ${project.version}` : ''}`);
  lines.push(`Electron：${project.electron ?? '未检测到'}`);
  lines.push(`包管理器：${project.packageManager ?? '未检测到锁文件'}`);
  lines.push(`打包器：${project.builder ?? '未检测到'}`);
  lines.push('');

  const findings = [...report.findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  if (findings.length === 0) lines.push('没有发现问题。');
  for (const finding of findings) lines.push(formatFinding(finding, paint, dim));
  lines.push('');

  const { summary } = report;
  lines.push(`结果：${summary.error} 个错误，${summary.warning} 个警告，${summary.info} 条提示`);
  if (summary.device > 0) {
    lines.push(`其中 ${summary.device} 项需要在统信 UOS / 银河麒麟真机上验证。`);
  }
  return `${lines.join('\n')}\n`;
}

function formatFinding(
  finding: Finding,
  paint: (severity: Severity, text: string) => string,
  dim: (text: string) => string,
): string {
  const tag = finding.verification === 'device' ? ' [需真机验证]' : '';
  const head = `${paint(finding.severity, SYMBOL[finding.severity])} ${dim(`[${finding.ruleId}]`)} ${finding.title}${tag}`;
  const body: string[] = [];
  if (finding.detail) body.push(`    原因：${finding.detail}`);
  if (finding.fix) body.push(`    建议：${finding.fix}`);
  return [head, ...body].join('\n');
}
