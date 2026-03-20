/** 休憩時間 (分) — 将来変更時はここだけ修正 */
export const BREAK_MINUTES = Number(process.env.BREAK_MINUTES ?? 120);

/** 所定労働時間 (分) — 将来変更時はここだけ修正 */
export const STANDARD_MINUTES = Number(process.env.STANDARD_MINUTES ?? 480);

/** セッション有効期間 (ミリ秒): 最終操作から7日 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 編集可能範囲 (日数): 無制限に変更 (以前は30日) */
// export const EDIT_WINDOW_DAYS = 30;

/** セッション Cookie 名 */
export const SESSION_COOKIE = "session_token";

/** 出勤区分の選択肢 */
export const ATTENDANCE_TYPES = [
  '出勤', '欠勤', '休日', '有給', '振休', '休日出勤',
] as const;

export type AttendanceType = typeof ATTENDANCE_TYPES[number];

/** 深夜時間帯の開始（分）: 22:00 = 1320 */
export const DEEP_NIGHT_START_MIN = 22 * 60;

/** 深夜時間帯の終了（分）: 翌5:00 = 29:00 = 1740 */
export const DEEP_NIGHT_END_MIN = (24 + 5) * 60;

/** 時刻フィールドの最大値（分）: 33:59 = 2039。夜勤後の帰社・退勤(翌朝)に対応。 */
export const MAX_TIME_MINUTES = 2039;
