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
 * 指定区間と深夜時間帯(22:00〜翌5:00)の重複分(分)を返す。
 * 深夜帯: 1320〜1740 の1区間。
 */
function calcDeepNightMinutes(start: number, end: number): number {
  if (start >= end) return 0;
  const overlapStart = Math.max(start, DEEP_NIGHT_START_MIN);
  const overlapEnd = Math.min(end, DEEP_NIGHT_END_MIN);
  return overlapEnd > overlapStart ? overlapEnd - overlapStart : 0;
}

/**
 * 現場作業時間・移動会社作業時間・残業時間・深夜勤務時間・休日出勤時間を算出する。
 *
 * 【計算ロジック（労基法準拠）】
 *
 * ■ 現場作業 = (作業終了 − 作業開始) − 休憩(2h)
 *   ※深夜時間帯を差し引かない（ベース賃金の算出用）
 *
 * ■ 移動・会社作業 = (出社→現場到着) + (作業終了→退勤)
 *
 * ■ 深夜勤務 = 全労働区間(作業+移動)と22:00〜翌5:00の重複分
 *   ※現場作業でも移動でも、22:00〜翌5:00に該当すれば深夜割増の対象
 *   ※休憩の控除: 深夜が多い勤務(夜勤)→深夜から先に引く
 *                 日中が多い勤務(日勤)→日中から先に引く
 *
 * ■ 残業 = (現場作業 + 移動) − 所定(8h)
 *   ※出勤区分に関係なく（通常・深夜・休日すべて）常に計算
 *
 * ■ 休日出勤 = 現場作業 + 移動（出勤区分が「休日出勤」のとき）
 *   ※深夜勤務・残業とは独立して集計（割増率が別々のため重複OK）
 */
export function computeDerivedColumns(report: RawReport): DerivedColumns {
  const result: DerivedColumns = {
    site_work_minutes: null,
    travel_office_minutes: null,
    overtime_minutes: null,
    deep_night_minutes: null,
    holiday_work_minutes: null,
  };

  // ========================================
  // 1. 現場作業時間（ベース: 作業終了 − 作業開始 − 休憩）
  // ========================================
  let siteWorkNet = 0;
  const hasWorkTime = report.work_start_time != null && report.work_end_time != null;

  if (hasWorkTime) {
    const gross = report.work_end_time! - report.work_start_time!;
    siteWorkNet = Math.max(gross - BREAK_MINUTES, 0);
    if (siteWorkNet > 0) {
      result.site_work_minutes = siteWorkNet;
    }
  }

  // ========================================
  // 2. 移動・会社作業時間
  // ========================================
  let travelMinutes = 0;
  if (
    report.start_time != null &&
    report.site_arrival_time != null &&
    report.work_end_time != null &&
    report.end_time != null
  ) {
    const toSite = report.site_arrival_time - report.start_time;
    const fromSite = report.end_time - report.work_end_time;
    if (toSite >= 0 && fromSite >= 0) {
      travelMinutes = toSite + fromSite;
      result.travel_office_minutes = travelMinutes;
    }
  }

  // ========================================
  // 3. 深夜勤務時間（全労働区間の22:00〜翌5:00重複分）
  //    現場作業でも移動でも、深夜帯に入れば25%割増の対象
  // ========================================
  let deepNightRaw = 0;
  let grossLabor = 0; // 全労働区間の合計（休憩控除前）

  // 区間A: 出社→現場到着（行きの移動）
  if (report.start_time != null && report.site_arrival_time != null) {
    const seg = report.site_arrival_time - report.start_time;
    if (seg > 0) {
      deepNightRaw += calcDeepNightMinutes(report.start_time, report.site_arrival_time);
      grossLabor += seg;
    }
  }
  // 区間B: 作業開始→作業終了（現場作業）
  if (hasWorkTime) {
    const seg = report.work_end_time! - report.work_start_time!;
    if (seg > 0) {
      deepNightRaw += calcDeepNightMinutes(report.work_start_time!, report.work_end_time!);
      grossLabor += seg;
    }
  }
  // 区間C: 作業終了→退勤（帰りの移動・社内作業）
  if (report.work_end_time != null && report.end_time != null) {
    const seg = report.end_time - report.work_end_time;
    if (seg > 0) {
      deepNightRaw += calcDeepNightMinutes(report.work_end_time, report.end_time);
      grossLabor += seg;
    }
  }

  // 移動情報がない場合は作業時間のみで集計
  if (grossLabor === 0 && hasWorkTime) {
    const seg = report.work_end_time! - report.work_start_time!;
    deepNightRaw = calcDeepNightMinutes(report.work_start_time!, report.work_end_time!);
    grossLabor = seg;
  }

  // 休憩の控除: 深夜と日中の大きい方から先に引く
  //  - 夜勤パターン（深夜 >= 日中）→ 深夜から先に引く
  //  - 日勤パターン（日中 > 深夜）→ 日中から先に引く（深夜はそのまま）
  if (deepNightRaw > 0) {
    const daytimeRaw = grossLabor - deepNightRaw;
    let deepNightNet: number;

    if (deepNightRaw >= daytimeRaw) {
      // 夜勤パターン: 休憩を深夜から先に引く
      if (deepNightRaw >= BREAK_MINUTES) {
        deepNightNet = deepNightRaw - BREAK_MINUTES;
      } else {
        deepNightNet = 0;
      }
    } else {
      // 日勤パターン: 休憩を日中から先に引く → 深夜はそのまま
      if (daytimeRaw >= BREAK_MINUTES) {
        deepNightNet = deepNightRaw;
      } else {
        // 日中だけでは休憩を吸収しきれない → 残りを深夜から引く
        deepNightNet = Math.max(deepNightRaw - (BREAK_MINUTES - daytimeRaw), 0);
      }
    }

    if (deepNightNet > 0) {
      result.deep_night_minutes = deepNightNet;
    }
  }

  // ========================================
  // 4. 残業時間 = (現場作業 + 移動) − 所定(8h)
  //    出勤区分に関係なく常に計算する
  // ========================================
  const totalNet = siteWorkNet + travelMinutes;
  if (totalNet > STANDARD_MINUTES) {
    result.overtime_minutes = totalNet - STANDARD_MINUTES;
  }

  // ========================================
  // 5. 休日出勤 = 現場作業 + 移動（出勤区分が「休日出勤」のとき）
  //    深夜勤務・残業とは独立（割増率が別々のため重複OK）
  // ========================================
  if (report.attendance_type === "休日出勤") {
    if (totalNet > 0) {
      result.holiday_work_minutes = totalNet;
    }
  }

  return result;
}
