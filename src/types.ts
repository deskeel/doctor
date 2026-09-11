export type Severity = 'error' | 'warning' | 'info';

/** local：可以在本地修复；device：必须在 UOS / 银河麒麟真机上验证。 */
export type Verification = 'local' | 'device';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface Finding {
  ruleId: string;
  severity: Severity;
  verification: Verification;
  /** 一句话结论。 */
  title: string;
  /** 为什么在 UOS / 银河麒麟上会出问题。 */
  detail?: string;
  /** 怎么改。 */
  fix?: string;
}

export interface Rule {
  id: string;
  title: string;
  /** 检查什么。 */
  description: string;
  /** 阈值或判断依据的来源，例如官方文档链接或真机验证记录。 */
  source: string;
  check(context: ProjectContext): Finding[] | Promise<Finding[]>;
}

export interface PackageJson {
  name?: string;
  version?: string;
  packageManager?: string;
  productName?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  build?: unknown;
  config?: { forge?: unknown } & Record<string, unknown>;
  [key: string]: unknown;
}

export interface LockfileInfo {
  file: string;
  packageManager: PackageManager;
}

export interface ElectronDependency {
  spec: string;
  field: 'dependencies' | 'devDependencies';
}

export interface BuilderConfig {
  kind: 'electron-builder' | 'forge';
  /** 配置来源，例如 `package.json#build` 或 `electron-builder.yml`。 */
  file: string;
  /** 无法静态读取（JS/TS 配置或解析失败）时为 null。 */
  config: Record<string, unknown> | null;
  error?: string;
}

export interface ProjectContext {
  cwd: string;
  packageJson: PackageJson | null;
  packageJsonError?: string;
  lockfiles: LockfileInfo[];
  electron: ElectronDependency | null;
  builder: BuilderConfig | null;
}

export interface ProjectSummary {
  name: string | null;
  version: string | null;
  electron: string | null;
  packageManager: PackageManager | null;
  builder: BuilderConfig['kind'] | null;
}

/** JSON 报告的结构版本。字段有不兼容变化时递增。 */
export const REPORT_SCHEMA_VERSION = 1;

export interface DoctorReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  doctorVersion: string;
  cwd: string;
  project: ProjectSummary;
  rules: string[];
  findings: Finding[];
  summary: Record<Severity, number> & { device: number };
  exitCode: 0 | 1;
}
