import type { DoctorReport } from '../types.ts';

export function renderJson(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}
