"use client";

import { useState, useEffect, useCallback } from "react";

// APIから返ってくる法定休日の型定義
type Holiday = {
  id: string;
  holiday_date: string; // "YYYY-MM-DD" 形式
};

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

/**
 * 指定月のカレンダー用データを生成する。
 * 月曜始まりで、前月・翌月の空セルも含めた二次元配列を返す。
 *
 * たとえ話: カレンダーの「枠」を作る関数。
 * 1日が水曜なら、月・火は空欄（null）になる。
 */
function buildCalendarGrid(year: number, month: number): (string | null)[][] {
  const weeks: (string | null)[][] = [];
  // その月の日数を取得（翌月の0日目＝今月の末日）
  const daysInMonth = new Date(year, month, 0).getDate();

  let currentWeek: (string | null)[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    // getDay() は 0=日曜, 1=月曜...6=土曜
    // 月曜始まりに変換: (getDay() + 6) % 7 → 0=月曜, 6=日曜
    const dayOfWeek = (date.getDay() + 6) % 7;

    // 月初の空セルを埋める
    if (day === 1) {
      for (let i = 0; i < dayOfWeek; i++) {
        currentWeek.push(null);
      }
    }

    // 日付を "YYYY-MM-DD" 形式で追加
    const m = String(month).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    currentWeek.push(`${year}-${m}-${d}`);

    // 週の終わり（日曜）または月末で行を確定
    if (dayOfWeek === 6 || day === daysInMonth) {
      // 月末の行を7セルに揃える
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  return weeks;
}

export default function HolidaysPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  // 登録済みの法定休日一覧（日付の Set で高速検索）
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map()); // date → id
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null); // 操作中の日付
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "error">("info");

  // 指定月の法定休日をAPIから取得する
  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/holidays?year=${year}&month=${month}`);
      if (!res.ok) {
        setMessage("法定休日の取得に失敗しました。");
        setMessageType("error");
        return;
      }
      const data: Holiday[] = await res.json();
      // 日付 → id のマップを作成（クリック時に削除用idが必要）
      const map = new Map<string, string>();
      for (const h of data) {
        map.set(h.holiday_date, h.id);
      }
      setHolidays(map);
    } catch {
      setMessage("通信エラーが発生しました。");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  // 月が変わるたびに法定休日を再取得
  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  // 前月へ移動
  function prevMonth() {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
    setMessage("");
  }

  // 翌月へ移動
  function nextMonth() {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
    setMessage("");
  }

  /**
   * 日付をクリックしたときのトグル処理。
   * すでに法定休日 → 削除（DELETE）
   * まだ法定休日でない → 登録（POST）
   */
  async function toggleHoliday(date: string) {
    if (toggling) return; // 二重クリック防止
    setToggling(date);
    setMessage("");

    try {
      const existingId = holidays.get(date);

      if (existingId) {
        // 既に登録済み → 削除
        const res = await fetch(`/api/admin/holidays?date=${date}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const d = await res.json();
          setMessage(d.error ?? "削除に失敗しました。");
          setMessageType("error");
          return;
        }
        // ローカル状態を即座に更新（再取得なしで高速表示）
        setHolidays((prev) => {
          const next = new Map(prev);
          next.delete(date);
          return next;
        });
      } else {
        // 未登録 → 新規登録
        const res = await fetch("/api/admin/holidays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ holiday_date: date }),
        });
        if (!res.ok) {
          const d = await res.json();
          setMessage(d.error ?? "登録に失敗しました。");
          setMessageType("error");
          return;
        }
        const created: Holiday = await res.json();
        // ローカル状態を即座に更新
        setHolidays((prev) => {
          const next = new Map(prev);
          next.set(created.holiday_date, created.id);
          return next;
        });
      }
    } catch {
      setMessage("通信エラーが発生しました。");
      setMessageType("error");
    } finally {
      setToggling(null);
    }
  }

  // カレンダーグリッドを生成
  const calendarWeeks = buildCalendarGrid(year, month);
  const holidayCount = holidays.size;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-bold text-gray-800">法定休日設定</h1>
      <p className="mb-6 text-xs text-gray-500">
        カレンダーの日付をクリックすると、法定休日の登録・解除ができます。
        <br />
        ここで設定した休日は、日報カレンダーに反映されます。
      </p>

      {/* 月ナビゲーション */}
      <div className="mb-4 flex items-center gap-4">
        <button
          onClick={prevMonth}
          className="rounded border border-gray-400 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
        >
          ◀ 前月
        </button>
        <h2 className="text-lg font-bold text-gray-800">
          {year}年{month}月
        </h2>
        <button
          onClick={nextMonth}
          className="rounded border border-gray-400 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
        >
          翌月 ▶
        </button>
      </div>

      {/* メッセージ表示 */}
      {message && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
            messageType === "error"
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-green-300 bg-green-50 text-green-700"
          }`}
        >
          <span>{messageType === "error" ? "⚠️" : "✅"}</span>
          <span>{message}</span>
        </div>
      )}

      {/* 法定休日件数バッジ */}
      <div className="mb-4 rounded-lg border bg-white px-4 py-3 shadow-sm">
        <span className="text-sm text-gray-600">
          {year}年{month}月の法定休日：
        </span>
        <span className={`ml-2 text-lg font-extrabold ${
          holidayCount > 0 ? "text-red-600" : "text-gray-400"
        }`}>
          {holidayCount}
        </span>
        <span className="ml-1 text-sm text-gray-500">件</span>
      </div>

      {/* カレンダー本体 */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        {/* 曜日ヘッダー */}
        <div className="grid grid-cols-7 border-b bg-gray-50">
          {WEEKDAY_LABELS.map((label, i) => (
            <div
              key={label}
              className={`py-2 text-center text-xs font-semibold ${
                i === 5
                  ? "text-blue-500"  // 土曜
                  : i === 6
                    ? "text-red-500" // 日曜
                    : "text-gray-600"
              }`}
            >
              {label}
            </div>
          ))}
        </div>

        {/* 日付グリッド */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-gray-400">
            読み込み中...
          </div>
        ) : (
          <div>
            {calendarWeeks.map((week, weekIdx) => (
              <div key={weekIdx} className="grid grid-cols-7 border-b last:border-0">
                {week.map((date, dayIdx) => {
                  if (!date) {
                    // 空セル（前月・翌月の領域）
                    return <div key={dayIdx} className="h-16 bg-gray-50/50" />;
                  }

                  const dayNum = parseInt(date.split("-")[2], 10);
                  const isHoliday = holidays.has(date);
                  const isToday = date === today.toISOString().slice(0, 10);
                  const isProcessing = toggling === date;

                  // 曜日による色分け（月曜始まり: 5=土曜, 6=日曜）
                  const isSat = dayIdx === 5;
                  const isSun = dayIdx === 6;

                  return (
                    <button
                      key={dayIdx}
                      onClick={() => toggleHoliday(date)}
                      disabled={isProcessing}
                      className={`
                        relative h-16 flex flex-col items-center justify-center
                        transition-all duration-150 cursor-pointer
                        hover:bg-blue-50 active:scale-95
                        disabled:cursor-wait disabled:opacity-60
                        ${isHoliday ? "bg-red-50" : ""}
                        ${isToday ? "ring-2 ring-inset ring-blue-400" : ""}
                      `}
                    >
                      {/* 日付の数字 */}
                      <span
                        className={`text-sm font-medium ${
                          isHoliday
                            ? "text-red-600 font-bold"
                            : isSun
                              ? "text-red-400"
                              : isSat
                                ? "text-blue-400"
                                : "text-gray-700"
                        }`}
                      >
                        {dayNum}
                      </span>

                      {/* 法定休日マーカー（赤い丸） */}
                      {isHoliday && (
                        <span className="mt-0.5 h-2 w-2 rounded-full bg-red-500" />
                      )}

                      {/* 処理中インジケーター */}
                      {isProcessing && (
                        <span className="absolute inset-0 flex items-center justify-center bg-white/60">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 凡例 */}
      <div className="mt-4 flex items-center gap-6 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
          <span>法定休日（クリックで解除）</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-blue-400" />
          <span>今日</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">日付をクリックで休日を登録</span>
        </div>
      </div>
    </div>
  );
}
