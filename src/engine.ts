import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };
import { loadProjectContext } from './context.ts';
import { type PackagingOptions, validatePackagingOptions } from './packaging/profile.ts';
import { checkProjectPackaging } from './packaging/project.ts';
import { builtinRules } from './rules/index.ts';
import {
  type DoctorReport,
  type Finding,
  type ProjectContext,
  type ProjectSummary,
  REPORT_SCHEMA_VERSION,
  type Rule,
} from './types.ts';

export interface RunOptions extends PackagingOptions {
  /** 要检查的工程目录，默认当前目录。 */
  cwd?: string;
  /** 自定义规则集，默认内置规则。 */
  rules?: readonly Rule[];
  /** 运行时刻，默认当前时间。用于固定日期类结论以便测试和复现。 */
  now?: Date;
}

function summarizeProject(context: ProjectContext): ProjectSummary {
  const lock = context.lockfiles[0];
  return {
    name: context.packageJson?.name ?? null,
    version: context.packageJson?.version ?? null,
    electron: context.electron?.spec ?? null,
    packageManager: lock?.packageManager ?? null,
    builder: context.builder?.kind ?? null,
  };
}

function summarizeFindings(findings: Finding[]): DoctorReport['summary'] {
  const summary = { error: 0, warning: 0, info: 0, device: 0 };
  for (const finding of findings) {
    summary[finding.severity] += 1;
    if (finding.verification === 'device') summary.device += 1;
  }
  return summary;
}

export async function runDoctor(options: RunOptions = {}): Promise<DoctorReport> {
  validatePackagingOptions(options);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const rules = options.rules ?? builtinRules;
  const context = await loadProjectContext(cwd, options.now ?? new Date());

  const findings: Finding[] = [];
  for (const rule of rules) {
    findings.push(...(await rule.check(context)));
  }

  const extra = options.target ? await checkProjectPackaging(context, options) : undefined;
  if (extra) findings.push(...extra.findings);
  const summary = summarizeFindings(findings);
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    ...(extra ? { packaging: extra.packaging } : {}),
    doctorVersion: pkg.version,
    cwd,
    project: summarizeProject(context),
    rules: rules.map((rule) => rule.id),
    findings,
    summary,
    exitCode: summary.error > 0 ? 1 : 0,
  };
}
