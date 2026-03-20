/**
 * 分 (0–1439) → "HH:MM" 文字列に変換
 */
export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * "HH:MM" 文字列 → 分 (0–1799) に変換。夜勤時刻（26:00等）にも対応。
 * 深夜帯の上限は29:59(=1799分)。無効な値は null を返す。
 */
export function hhmmToMinutes(hhmm: string): number | null {
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);

  if (m > 59) return null;

  const total = h * 60 + m;

  if (total < 0 || total > 1799) return null;
  return total;
}
