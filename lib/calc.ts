import "server-only";
import { BREAK_MINUTES, STANDARD_MINUTES } from "@/lib/constants";

export type RawReport = {
  start_time: number | null;
  end_time: number | null;
};

export type DerivedColumns = {
  actual_work_minutes: number | null;
  overtime_minutes: number | null;
};

/**
 * 実労働時間・残業時間を算出する。
 * start_time / end_time のいずれかが null の場合は計算不可として null を返す。
 */
export function computeDerivedColumns(report: RawReport): DerivedColumns {
  if (report.start_time == null || report.end_time == null) {
    return { actual_work_minutes: null, overtime_minutes: null };
  }

  const worked = report.end_time - report.start_time - BREAK_MINUTES;
  if (worked < 0) {
    return { actual_work_minutes: null, overtime_minutes: null };
  }
  const overtime = Math.max(worked - STANDARD_MINUTES, 0);

  return {
    actual_work_minutes: worked,
    overtime_minutes: overtime,
  };
}
