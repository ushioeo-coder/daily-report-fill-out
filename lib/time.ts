/**
 * 分 (0–2039) → "HH:MM" 文字列に変換
 */
export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 全角数字・全角コロンを半角に変換する。
 * 日本語IMEで入力した場合に全角文字が混ざることがあるため。
 */
function normalizeInput(s: string): string {
  // 全角数字(０-９) → 半角(0-9)
  let result = s.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30)
  );
  // 全角コロン(：) → 半角(:)
  result = result.replace(/：/g, ":");
  return result;
}

/**
 * "HH:MM" 文字列 → 分 (0–2039) に変換。夜勤時刻（26:00等）にも対応。
 * 上限は33:59(=2039分)。帰社・退勤の夜勤後入力に対応。
 * 全角文字やコロンなし("0800")の入力も受け付ける。
 * 無効な値は null を返す。
 */
export function hhmmToMinutes(hhmm: string): number | null {
  // 全角→半角に正規化
  const normalized = normalizeInput(hhmm.trim());

  // "HH:MM" 形式を試す
  let match = normalized.match(/^(\d{1,2}):(\d{2})$/);

  // コロンなし "HHMM" 形式 (3桁 "800" or 4桁 "0830") も受け付ける
  if (!match) {
    match = normalized.match(/^(\d{1,2})(\d{2})$/);
  }

  if (!match) return null;

  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);

  if (m > 59) return null;

  const total = h * 60 + m;

  if (total < 0 || total > 2039) return null;
  return total;
}
