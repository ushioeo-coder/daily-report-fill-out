"use client";

import { useEffect, useState, useCallback } from "react";
import { minutesToHHMM, hhmmToMinutes } from "@/lib/time";

type User = {
  id: string;
  employee_id: string;
  name: string;
  role: string;
};

type Report = {
  id?: string;
  user_id: string;
  report_date: string;
  start_time: number | null;
  site_arrival_time: number | null;
  work_start_time: number | null;
  work_end_time: number | null;
  return_time: number | null;
  end_time: number | null;
  note: string | null;
  site_work_minutes?: number | null;
  travel_office_minutes?: number | null;
  overtime_minutes?: number | null;
};

/** 時間フィールド定義 (表示順) */
const TIME_COLUMNS: { key: keyof Report; label: string }[] = [
  { key: "start_time", label: "①出社" },
  { key: "site_arrival_time", label: "②現場到着" },
  { key: "work_start_time", label: "③作業開始" },
  { key: "work_end_time", label: "④作業終了" },
  { key: "return_time", label: "⑤帰社" },
  { key: "end_time", label: "⑥退勤" },
];

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function getWeekday(dateStr: string): string {
  return WEEKDAYS[new Date(dateStr + "T00:00:00").getDay()];
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + "T00:00:00").getDay();
  return day === 0 || day === 6;
}

function isFutureDate(dateStr: string): boolean {
  const today = new Date().toISOString().split("T")[0];
  return dateStr > today;
}

function getDaysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const date = new Date(year, month - 1, 1);
  while (date.getMonth() === month - 1) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    days.push(`${y}-${m}-${d}`);
    date.setDate(date.getDate() + 1);
  }
  return days;
}

function formatMinutes(min: number | null | undefined): string {
  if (min == null) return "-";
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  const sign = min < 0 ? "-" : "";
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

export default function AdminReportsPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [reports, setReports] = useState<Map<string, Report>>(new Map());
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "error">("info");
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(/Mobi|Android/i.test(navigator.userAgent));
  }, []);

  const days = getDaysInMonth(year, month);
  const from = days[0];
  const to = days[days.length - 1];

  // ユーザー一覧取得
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/users");
      if (!res.ok) return;
      const data: User[] = await res.json();
      setUsers(data);
      if (data.length > 0 && !selectedUserId) {
        setSelectedUserId(data[0].id);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 日報取得
  const fetchReports = useCallback(async () => {
    if (!selectedUserId) return;
    const res = await fetch(
      `/api/reports?from=${from}&to=${to}&user_id=${selectedUserId}`
    );
    if (!res.ok) return;
    const data: Report[] = await res.json();
    const map = new Map<string, Report>();
    for (const r of data) {
      map.set(r.report_date.slice(0, 10), r);
    }
    setReports(map);
  }, [from, to, selectedUserId]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  function prevMonth() {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  }

  function nextMonth() {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  }

  function updateLocal(date: string, field: keyof Report, value: string | number | null) {
    setReports((prev) => {
      const next = new Map(prev);
      const existing = next.get(date) ?? {
        user_id: selectedUserId,
        report_date: date,
        start_time: null,
        site_arrival_time: null,
        work_start_time: null,
        work_end_time: null,
        return_time: null,
        end_time: null,
        note: null,
      };
      next.set(date, { ...existing, [field]: value });
      return next;
    });
  }

  /** スマートな時間入力処理 (0830 -> 08:30) */
  function handleSmartTimeChange(date: string, field: keyof Report, value: string) {
    let finalValue = value;
    if (/^\d{4}$/.test(value)) {
      finalValue = value.slice(0, 2) + ":" + value.slice(2);
    }
    const mins = hhmmToMinutes(finalValue);
    updateLocal(date, field, mins);
  }

  async function saveRow(date: string) {
    // 未来日チェック
    if (isFutureDate(date)) {
      setMessage("未来の日付には入力できません。");
      setMessageType("error");
      return;
    }

    const report = reports.get(date);
    if (!report) return;

    setSaving(date);
    setMessage("");

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_date: date,
          start_time: report.start_time,
          site_arrival_time: report.site_arrival_time,
          work_start_time: report.work_start_time,
          work_end_time: report.work_end_time,
          return_time: report.return_time,
          end_time: report.end_time,
          note: report.note || null,
          user_id: selectedUserId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setMessage(data.error ?? "保存に失敗しました。");
        setMessageType("error");
        return;
      }

      await fetchReports();
      setMessage(`${date} を保存しました。`);
      setMessageType("info");
    } catch {
      setMessage("通信エラーが発生しました。");
      setMessageType("error");
    } finally {
      setSaving(null);
    }
  }


  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <div>
      {/* ユーザー選択 + 月ナビゲーション */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <select
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          className="rounded border px-3 py-1.5 text-sm text-gray-900"
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.employee_id} - {u.name}
            </option>
          ))}
        </select>

        <button
          onClick={prevMonth}
          className="rounded border px-3 py-1 text-sm hover:bg-gray-100"
        >
          前月
        </button>
        <h2 className="text-lg font-bold text-gray-800">
          {year}年{month}月
        </h2>
        <button
          onClick={nextMonth}
          className="rounded border px-3 py-1 text-sm hover:bg-gray-100"
        >
          翌月
        </button>

        {selectedUser && (
          <span className="text-sm text-gray-500">
            {selectedUser.name}
          </span>
        )}
      </div>

      {message && (
        <p
          className={`mb-3 text-sm ${messageType === "error" ? "text-red-600" : "text-blue-600"}`}
        >
          {message}
        </p>
      )}

      {/* 日報テーブル (計算列付き) */}
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-600">
              <th className="px-2 py-2 whitespace-nowrap">日</th>
              <th className="px-2 py-2 whitespace-nowrap">曜</th>
              {TIME_COLUMNS.map((col) => (
                <th key={col.key} className="px-1 py-2 whitespace-nowrap">
                  {col.label}
                </th>
              ))}
              <th className="px-2 py-2 whitespace-nowrap">移動・会社作業</th>
              <th className="px-2 py-2 whitespace-nowrap">現場作業</th>
              <th className="px-2 py-2 whitespace-nowrap">残業</th>
              <th className="px-2 py-2">備考</th>
              <th className="sticky right-0 bg-gray-50 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {days.map((date) => {
              const report = reports.get(date);
              const weekday = getWeekday(date);
              const weekend = isWeekend(date);
              const future = isFutureDate(date);
              const dayNum = date.split("-")[2];
              const rowBg = weekend ? "bg-gray-50" : "bg-white";

              return (
                <tr
                  key={date}
                  className={`border-b ${weekend ? "bg-gray-50 text-gray-400" : ""} ${future ? "opacity-50" : ""}`}
                >
                  <td className="px-2 py-1 whitespace-nowrap">{dayNum}</td>
                  <td
                    className={`px-2 py-1 whitespace-nowrap ${weekday === "日"
                      ? "text-red-500"
                      : weekday === "土"
                        ? "text-blue-500"
                        : ""
                      }`}
                  >
                    {weekday}
                  </td>
                  {TIME_COLUMNS.map((col) => {
                    const timeValue = report?.[col.key] != null ? minutesToHHMM(report[col.key] as number) : "";
                    return (
                      <td key={col.key} className="px-1 py-1">
                        <div className="group relative flex items-center">
                          {isMobile ? (
                            <input
                              type="time"
                              value={timeValue}
                              onChange={(e) => updateLocal(date, col.key, hhmmToMinutes(e.target.value))}
                              onClick={(e) => {
                                try { (e.target as any).showPicker(); } catch (err) { }
                              }}
                              disabled={future}
                              className="w-[6.5rem] rounded border px-2 py-1 text-xs text-gray-900 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 pr-5 transition-colors hover:border-blue-400"
                            />
                          ) : (
                            <div className="relative flex items-center w-[7rem]">
                              <input
                                type="text"
                                placeholder="08:30"
                                value={timeValue}
                                onChange={(e) => handleSmartTimeChange(date, col.key, e.target.value)}
                                disabled={future}
                                className="w-full rounded border px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 pr-8 transition-colors hover:border-blue-400"
                              />
                              <input
                                type="time"
                                className="absolute opacity-0 pointer-events-none w-0 h-0"
                                value={timeValue}
                                onChange={(e) => updateLocal(date, col.key, hhmmToMinutes(e.target.value))}
                              />
                              {!future && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    const hiddenInput = e.currentTarget.previousSibling as HTMLInputElement;
                                    try { (hiddenInput as any).showPicker(); } catch (err) { }
                                  }}
                                  className="absolute right-6 p-1 text-gray-400 hover:text-blue-500 hidden group-hover:block"
                                  title="時計から選択"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                </button>
                              )}
                              {timeValue && !future && (
                                <button
                                  onClick={() => updateLocal(date, col.key, null)}
                                  className="absolute right-1 p-1 text-gray-300 hover:text-red-500 hidden group-hover:block"
                                  title="クリア"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 whitespace-nowrap text-gray-700">
                    {formatMinutes(report?.travel_office_minutes)}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap text-gray-700">
                    {formatMinutes(report?.site_work_minutes)}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap text-gray-700">
                    {formatMinutes(report?.overtime_minutes)}
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={report?.note ?? ""}
                      onChange={(e) =>
                        updateLocal(date, "note", e.target.value)
                      }
                      disabled={future}
                      placeholder="備考"
                      className="w-full min-w-[5rem] rounded border px-1.5 py-0.5 text-xs text-gray-900 placeholder-gray-300 disabled:bg-gray-100"
                    />
                  </td>
                  <td
                    className={`sticky right-0 ${rowBg} px-2 py-1`}
                  >
                    <button
                      onClick={() => saveRow(date)}
                      disabled={saving === date || future}
                      className="rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving === date ? "..." : "保存"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
