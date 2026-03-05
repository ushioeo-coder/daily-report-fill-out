import "server-only";
import { BREAK_MINUTES, STANDARD_MINUTES } from "@/lib/constants";

export type RawReport = {
  start_time: number | null;
  site_arrival_time: number | null;
  work_start_time: number | null;
  work_end_time: number | null;
  return_time: number | null;
  end_time: number | null;
};

export type DerivedColumns = {
  site_work_minutes: number | null;
  travel_office_minutes: number | null;
  overtime_minutes: number | null;
};

/**
 * 現場作業時間・移動会社作業時間・残業時間を算出する。
 */
export function computeDerivedColumns(report: RawReport): DerivedColumns {
  const result: DerivedColumns = {
    site_work_minutes: null,
    travel_office_minutes: null,
    overtime_minutes: null,
  };

  // 残業 = 退勤 - 出社 - 休憩 - 所定時間
  if (report.start_time != null && report.end_time != null) {
    const worked = report.end_time - report.start_time - BREAK_MINUTES;
    if (worked >= 0) {
      result.overtime_minutes = Math.max(worked - STANDARD_MINUTES, 0);
    }
  }

  // 現場作業時間 = 現場到着 → 現場作業終了
  if (report.site_arrival_time != null && report.work_end_time != null) {
    const siteWork = report.work_end_time - report.site_arrival_time;
    if (siteWork >= 0) {
      result.site_work_minutes = siteWork;
    }
  }

  // 移動・会社作業時間 = (出社→現場到着) + (現場作業終了→退勤)
  if (
    report.start_time != null &&
    report.site_arrival_time != null &&
    report.work_end_time != null &&
    report.end_time != null
  ) {
    const toSite = report.site_arrival_time - report.start_time;
    const fromSite = report.end_time - report.work_end_time;
    if (toSite >= 0 && fromSite >= 0) {
      result.travel_office_minutes = toSite + fromSite;
    }
  }

  return result;
}
