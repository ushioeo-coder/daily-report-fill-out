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
 *
 * - 現場作業時間 = 作業開始→作業終了 - 休憩(2:00)
 * - 移動・会社作業時間 = (出社→現場到着) + (現場作業終了→退勤)
 * - 残業時間 = 移動・会社作業時間 + 現場作業時間 - 所定(8:00)
 */
export function computeDerivedColumns(report: RawReport): DerivedColumns {
  const result: DerivedColumns = {
    site_work_minutes: null,
    travel_office_minutes: null,
    overtime_minutes: null,
  };

  // 現場作業時間 = 作業開始→作業終了 - 休憩(2:00)
  if (report.work_start_time != null && report.work_end_time != null) {
    const siteWork = report.work_end_time - report.work_start_time - BREAK_MINUTES;
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

  // 残業時間 = 移動・会社作業時間 + 現場作業時間 - 所定(8:00)
  if (result.travel_office_minutes != null && result.site_work_minutes != null) {
    const total = result.travel_office_minutes + result.site_work_minutes;
    result.overtime_minutes = Math.max(total - STANDARD_MINUTES, 0);
  }

  return result;
}
