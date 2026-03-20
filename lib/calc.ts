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
 * 【計算ロジック（労基法準拠）】
 *
 * 1. 総作業時間（gross）= 作業終了 − 作業開始
 * 2. 深夜生時間（deepNightRaw）= 作業時間と22:00〜翌5:00の重複分
 * 3. 通常生時間（regularRaw）= gross − deepNightRaw
 * 4. 休憩(2h)は深夜時間から優先的に控除する:
 *    - deepNightRaw >= 休憩 → 深夜net = deepNightRaw − 休憩, 通常net = regularRaw
 *    - deepNightRaw <  休憩 → 深夜net = 0, 通常net = regularRaw − (休憩 − deepNightRaw)
 * 5. 現場作業時間 = 通常net（深夜を除いた昼間の正味作業時間）
 * 6. 移動・会社作業時間 = (出社→現場到着) + (現場作業終了→退勤)
 * 7. 残業時間 = (移動 + 現場作業 + 深夜net) − 所定(8:00)
 *    ※移動がnullの場合は0として計算
 *    ※出勤区分に関係なく（通常・深夜・休日問わず）常に計算する
 * 8. 休日出勤 = 出勤区分が「休日出勤」の場合の総労働時間 − 休憩
 *    ※深夜勤務・残業とは独立して集計（割増率が別々のため重複OK）
 */
export function computeDerivedColumns(report: RawReport): DerivedColumns {
  const result: DerivedColumns = {
    site_work_minutes: null,
    travel_office_minutes: null,
    overtime_minutes: null,
    deep_night_minutes: null,
    holiday_work_minutes: null,
  };

  // --- Step 1〜4: 深夜・通常の正味時間を算出（休憩は1回だけ控除） ---
  let deepNightNet = 0;   // 深夜の正味時間（休憩控除後）
  let regularNet = 0;     // 通常の正味時間（休憩控除後）
  let hasWorkTime = false; // 作業時間が入力されているか

  if (report.work_start_time != null && report.work_end_time != null) {
    hasWorkTime = true;
    const gross = report.work_end_time - report.work_start_time; // 総作業時間
    const deepNightRaw = calcDeepNightMinutes(report.work_start_time, report.work_end_time);
    const regularRaw = gross - deepNightRaw; // 深夜以外の生時間

    // 休憩を深夜時間から優先的に控除する
    if (deepNightRaw >= BREAK_MINUTES) {
      // 深夜時間だけで休憩を吸収できる場合
      deepNightNet = deepNightRaw - BREAK_MINUTES;
      regularNet = Math.max(regularRaw, 0);
    } else {
      // 深夜時間だけでは休憩を吸収しきれない → 残りを通常時間から引く
      deepNightNet = 0;
      const remainingBreak = BREAK_MINUTES - deepNightRaw;
      regularNet = Math.max(regularRaw - remainingBreak, 0);
    }

    // 深夜勤務時間をセット（0の場合はnullのまま）
    if (deepNightNet > 0) {
      result.deep_night_minutes = deepNightNet;
    }

    // 現場作業時間 = 通常の正味時間（0の場合はnullのまま）
    if (regularNet > 0) {
      result.site_work_minutes = regularNet;
    }
  }

  // --- Step 6: 移動・会社作業時間 ---
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

  // --- Step 7: 残業時間 ---
  // 深夜も含めた総労働時間から所定(8h)を引く
  // 移動時間がnullでも、作業時間があれば残業を計算する
  if (hasWorkTime) {
    const travel = result.travel_office_minutes ?? 0;
    const totalWork = travel + regularNet + deepNightNet;
    const overtime = totalWork - STANDARD_MINUTES;
    if (overtime > 0) {
      result.overtime_minutes = overtime;
    }
  }

  // --- 休日出勤の場合 ---
  // 休日出勤時間を算出する。深夜勤務・残業とは独立して集計する。
  // （休日出勤25%、深夜25%、残業25%はそれぞれ別の割増なので重複OK）
  if (report.attendance_type === "休日出勤") {
    // 出社〜退勤が揃っていれば「退勤 − 出社 − 休憩」で休日出勤の総労働時間
    if (report.start_time != null && report.end_time != null) {
      const total = report.end_time - report.start_time - BREAK_MINUTES;
      if (total > 0) {
        result.holiday_work_minutes = total;
      }
    } else if (hasWorkTime) {
      // 揃っていない場合は作業ベースで代替
      const travel = result.travel_office_minutes ?? 0;
      const totalWork = travel + regularNet + deepNightNet;
      if (totalWork > 0) {
        result.holiday_work_minutes = totalWork;
      }
    }
    // ※ 深夜勤務・残業はリセットしない（それぞれ独立した割増のため）
  }

  return result;
}
