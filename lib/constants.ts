/** 休憩時間 (分) — 将来変更時はここだけ修正 */
export const BREAK_MINUTES = Number(process.env.BREAK_MINUTES ?? 120);

/** 所定労働時間 (分) — 将来変更時はここだけ修正 */
export const STANDARD_MINUTES = Number(process.env.STANDARD_MINUTES ?? 480);

/** セッション有効期間 (ミリ秒): 最終操作から7日 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 編集可能範囲 (日数): 当日から過去30日 */
export const EDIT_WINDOW_DAYS = 30;
