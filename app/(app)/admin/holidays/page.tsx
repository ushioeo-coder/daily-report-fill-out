"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

// APIから返ってくる法定休日の型定義
type Holiday = {
  id: string;
  holiday_date: string; // "YYYY-MM-DD" 形式
};

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

/**
 * 指定月のカレンダー用データを生成する。
 * 月曜始まりで、前月・翌月の空セルも含めた二次元配列を返す。
 */
function buildCalendarGrid(year: number, month: number): (string | null)[][] {
  const weeks: (string | null)[][] = [];
  const daysInMonth = new Date(year, month, 0).getDate();

  let currentWeek: (string | null)[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    // 月曜始まりに変換: (getDay() + 6) % 7 → 0=月曜, 6=日曜
    const dayOfWeek = (date.getDay() + 6) % 7;

    if (day === 1) {
      for (let i = 0; i < dayOfWeek; i++) {
        currentWeek.push(null);
      }
    }

    const m = String(month).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    currentWeek.push(`${year}-${m}-${d}`);

    if (dayOfWeek === 6 || day === daysInMonth) {
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

  // DB上の状態: date → id のマップ
  const [savedHolidays, setSavedHolidays] = useState<Map<string, string>>(new Map());
  // 画面上の仮選択状態（保存前）
  const [pendingDates, setPendingDates] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "error">("info");

  // 未保存の変更件数（追加予定 + 削除予定の合計）
  const dirtyCount = useMemo(() => {
    let count = 0;
    for (const d of pendingDates) {
      if (!savedHolidays.has(d)) count++;
    }
    for (const d of savedHolidays.keys()) {
      if (!pendingDates.has(d)) count++;
    }
    return count;
  }, [pendingDates, savedHolidays]);

  // 指定月の法定休日をAPIから取得し、pending も同期する
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
      const map = new Map<string, string>();
      for (const h of data) {
        map.set(h.holiday_date, h.id);
      }
      setSavedHolidays(map);
      // 取得したDB状態に合わせてpendingもリセット
      setPendingDates(new Set(map.keys()));
    } catch {
      setMessage("通信エラーが発生しました。");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  // 月が変わるたびに取得（未保存変更はリセットされる）
  useEffect(() => {
    setMessage("");
    fetchHolidays();
  }, [fetchHolidays]);

  function prevMonth() {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else { setMonth(month - 1); }
  }

  function nextMonth() {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else { setMonth(month + 1); }
  }

  // クリック → pendingDates のみ更新（APIは叩かない）
  function toggleHoliday(date: string) {
    setMessage("");
    setPendingDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  // 保存ボタン → DBとの差分を一括送信
  async function handleSave() {
    if (dirtyCount === 0) return;
    setSaving(true);
    setMessage("");

    // 追加すべき日付: pendingにあってsavedにない
    const toAdd: string[] = [];
    // 削除すべき日付: savedにあってpendingにない
    const toDelete: string[] = [];

    for (const d of pendingDates) {
      if (!savedHolidays.has(d)) toAdd.push(d);
    }
    for (const d of savedHolidays.keys()) {
      if (!pendingDates.has(d)) toDelete.push(d);
    }

    try {
      const results = await Promise.all([
        ...toAdd.map((date) =>
          fetch("/api/admin/holidays", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ holiday_date: date }),
          })
        ),
        ...toDelete.map((date) =>
          fetch(`/api/admin/holidays?date=${date}`, { method: "DELETE" })
        ),
      ]);

      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        setMessage("一部の保存に失敗しました。再度お試しください。");
        setMessageType("error");
        // 失敗した場合でもDB最新状態を再取得して同期
        await fetchHolidays();
        return;
      }

      // 成功: DB状態を再取得して確定
      await fetchHolidays();
      const total = toAdd.length + toDelete.length;
      setMessage(`${total}件の変更を保存しました。日報カレンダーに反映されます。`);
      setMessageType("info");
    } catch {
      setMessage("通信エラーが発生しました。");
      setMessageType("error");
    } finally {
      setSaving(false);
    }
  }

  const calendarWeeks = buildCalendarGrid(year, month);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-bold text-gray-800">法定休日設定</h1>
      <p className="mb-6 text-xs text-gray-500">
        カレンダーの日付をクリックして休日を選択し、「保存」ボタンを押すと日報カレンダーに反映されます。
      </p>

      {/* 月ナビゲーション + 保存ボタン */}
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

        <div className="ml-auto flex items-center gap-2">
          {dirtyCount > 0 && (
            <span className="text-xs font-medium text-amber-600">
              {dirtyCount}件 未保存
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || dirtyCount === 0}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
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
          pendingDates.size > 0 ? "text-red-600" : "text-gray-400"
        }`}>
          {pendingDates.size}
        </span>
        <span className="ml-1 text-sm text-gray-500">件</span>
        {dirtyCount > 0 && (
          <span className="ml-3 text-xs text-amber-600">（未保存の変更あり）</span>
        )}
      </div>

      {/* カレンダー本体 */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        {/* 曜日ヘッダー */}
        <div className="grid grid-cols-7 border-b bg-gray-50">
          {WEEKDAY_LABELS.map((label, i) => (
            <div
              key={label}
              className={`py-2 text-center text-xs font-semibold ${
                i === 5 ? "text-blue-500" : i === 6 ? "text-red-500" : "text-gray-600"
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
                    return <div key={dayIdx} className="h-16 bg-gray-50/50" />;
                  }

                  const dayNum = parseInt(date.split("-")[2], 10);
                  const isSelected = pendingDates.has(date);
                  const isSaved = savedHolidays.has(date);
                  const isToday = date === today.toISOString().slice(0, 10);

                  // 未保存の変更かどうか
                  const isPendingAdd = isSelected && !isSaved;    // 追加予定
                  const isPendingRemove = !isSelected && isSaved; // 削除予定

                  const isSat = dayIdx === 5;
                  const isSun = dayIdx === 6;

                  return (
                    <button
                      key={dayIdx}
                      onClick={() => toggleHoliday(date)}
                      className={`
                        relative h-16 flex flex-col items-center justify-center
                        transition-all duration-150 cursor-pointer
                        hover:bg-blue-50 active:scale-95
                        ${isSelected ? "bg-red-50" : ""}
                        ${isPendingRemove ? "bg-gray-100 opacity-60" : ""}
                        ${isToday ? "ring-2 ring-inset ring-blue-400" : ""}
                      `}
                    >
                      {/* 日付の数字 */}
                      <span
                        className={`text-sm font-medium ${
                          isSelected
                            ? "text-red-600 font-bold"
                            : isPendingRemove
                              ? "text-gray-400 line-through"
                              : isSun
                                ? "text-red-400"
                                : isSat
                                  ? "text-blue-400"
                                  : "text-gray-700"
                        }`}
                      >
                        {dayNum}
                      </span>

                      {/* マーカー: 保存済み=赤丸 / 追加予定=橙枠 / 削除予定=なし */}
                      {isSelected && !isPendingAdd && (
                        <span className="mt-0.5 h-2 w-2 rounded-full bg-red-500" />
                      )}
                      {isPendingAdd && (
                        <span className="mt-0.5 h-2 w-2 rounded-full border-2 border-orange-400 bg-orange-100" />
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
      <div className="mt-4 flex flex-wrap items-center gap-6 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
          <span>保存済み休日</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-orange-400 bg-orange-100" />
          <span>追加予定（未保存）</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-blue-400" />
          <span>今日</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">日付をクリックで選択 → 保存ボタンで確定</span>
        </div>
      </div>
    </div>
  );
}
