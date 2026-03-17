import "server-only";
import { BREAK_MINUTES, STANDARD_MINUTES, DEEP_NIGHT_START_MIN, DEEP_NIGHT_END_MIN } from "@/lib/constants";

export type RawReport = {
  attendance_type: string | null;  // 出勤区分 (休日出勤判定に使用)
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
  deep_night_minutes: number | null;
  holiday_work_minutes: number | null;  // 休日出勤時の総労働時間
};

/**
 * 深夜勤務時間を計算する。
 * 深夜時間帯: 22:00(1320分) ～ 翌5:00(1740分)
 * 作業開始～作業終了の区間と深夜時間帯の重複分を返す。
 *
 * 前提:
 *  - workStart / workEnd は「当日0:00からの分」で表現される
 *  - 夜勤時刻は 24h 超の分値（例: 26:00 = 1560分）で渡される
 *  - workEnd は最大 2879（47:59）まで許容
 *  - 深夜帯の判定は 1320〜1740 の1区間のみ（翌日22時以降への跨ぎは想定外）
 */
function calcDeepNightMinutes(workStart: number, workEnd: number): number {
  const overlapStart = Math.max(workStart, DEEP_NIGHT_START_MIN);
  const overlapEnd = Math.min(workEnd, DEEP_NIGHT_END_MIN);
  return overlapEnd > overlapStart ? overlapEnd - overlapStart : 0;
}

/**
 * 現場作業時間・移動会社作業時間・残業時間・深夜勤務時間・休日出勤時間を算出する。
 *
 * - 現場作業時間 = 作業開始→作業終了 - 休憩(2:00)
 * - 移動・会社作業時間 = (出社→現場到着) + (現場作業終了→退勤)
 * - 残業時間 = 移動・会社作業時間 + 現場作業時間 - 所定(8:00)
 * - 深夜勤務時間 = 作業時間と22:00～翌5:00の重複分
 * - 休日出勤時間 = 出勤区分が「休日出勤」の場合の総労働時間（現場+移動・会社作業）
 */
export function computeDerivedColumns(report: RawReport): DerivedColumns {
  const result: DerivedColumns = {
    site_work_minutes: null,
    travel_office_minutes: null,
    overtime_minutes: null,
    deep_night_minutes: null,
    holiday_work_minutes: null,
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

  // 深夜勤務時間（22:00〜翌5:00）
  if (report.work_start_time != null && report.work_end_time != null) {
    result.deep_night_minutes = calcDeepNightMinutes(
      report.work_start_time,
      report.work_end_time
    );
  }

  // 休日出勤時間 = 出勤区分が「休日出勤」のときの総労働時間
  // （現場作業時間 + 移動・会社作業時間のいずれか、またはその合計）
  if (report.attendance_type === "休日出勤") {
    const site = result.site_work_minutes ?? 0;
    const travel = result.travel_office_minutes ?? 0;
    if (result.site_work_minutes != null || result.travel_office_minutes != null) {
      result.holiday_work_minutes = site + travel;
    }
  }

  return result;
}
