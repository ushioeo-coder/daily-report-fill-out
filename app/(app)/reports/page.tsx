"use client";

import { useEffect, useState, useCallback } from "react";
import { minutesToHHMM, hhmmToMinutes } from "@/lib/time";

type Report = {
  id?: string;
  report_date: string;
  attendance_type: string | null;
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
  deep_night_minutes?: number | null;
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

/** 指定月の全日付を YYYY-MM-DD の配列で返す */
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

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function getWeekday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return WEEKDAYS[d.getDay()];
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + "T00:00:00").getDay();
  return day === 0 || day === 6;
}

function isFutureDate(dateStr: string): boolean {
  const today = new Date().toISOString().split("T")[0];
  return dateStr > today;
}

function formatMinutes(min: number | null | undefined): string {
  if (min == null) return "-";
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  const sign = min < 0 ? "-" : "";
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

const EMPTY_REPORT: Omit<Report, "report_date"> = {
  attendance_type: null,
  start_time: null,
  site_arrival_time: null,
  work_start_time: null,
  work_end_time: null,
  return_time: null,
  end_time: null,
  note: null,
};

export default function ReportsPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [reports, setReports] = useState<Map<string, Report>>(new Map());
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "error">("info");
  const [rawInputs, setRawInputs] = useState<Map<string, string>>(new Map());

  function getRawKey(date: string, field: string) {
    return `${date}__${field}`;
  }

  const days = getDaysInMonth(year, month);
  const from = days[0];
  const to = days[days.length - 1];

  const fetchReports = useCallback(async () => {
    const res = await fetch(`/api/reports?from=${from}&to=${to}`);
    if (!res.ok) return;
    const data: Report[] = await res.json();
    const map = new Map<string, Report>();
    for (const r of data) {
      map.set(r.report_date.slice(0, 10), r);
    }
    setReports(map);
  }, [from, to]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  function prevMonth() {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  }

  function nextMonth() {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  }

  function updateLocal(date: string, field: keyof Report, value: string | number | null) {
    setReports((prev) => {
      const next = new Map(prev);
      const existing = next.get(date) ?? {
        report_date: date,
        ...EMPTY_REPORT,
      };
      next.set(date, { ...existing, [field]: value });
      return next;
    });
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
          attendance_type: report.attendance_type ?? null,
          start_time: report.start_time,
          site_arrival_time: report.site_arrival_time,
          work_start_time: report.work_start_time,
          work_end_time: report.work_end_time,
          return_time: report.return_time,
          end_time: report.end_time,
          note: report.note || null,
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

  return (
    <div>
      {/* 月ナビゲーション */}
      <div className="mb-4 flex items-center gap-4">
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
      </div>

      {message && (
        <p
          className={`mb-3 text-sm ${messageType === "error" ? "text-red-600" : "text-blue-600"}`}
        >
          {message}
        </p>
      )}

      {/* 日報テーブル */}
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-600">
              <th className="px-2 py-2 whitespace-nowrap">日</th>
              <th className="px-2 py-2 whitespace-nowrap">曜</th>
              <th className="px-2 py-2 whitespace-nowrap">出勤区分</th>
              {TIME_COLUMNS.map((col) => (
                <th key={col.key} className="px-1 py-2 whitespace-nowrap">
                  {col.label}
                </th>
              ))}
              <th className="px-2 py-2 whitespace-nowrap">移動・会社作業</th>
              <th className="px-2 py-2 whitespace-nowrap">現場作業</th>
              <th className="px-2 py-2 whitespace-nowrap">残業</th>
              <th className="px-2 py-2 whitespace-nowrap">深夜勤務</th>
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
                  <td className="px-1 py-1">
                    <select
                      value={report?.attendance_type ?? ""}
                      onChange={(e) =>
                        updateLocal(date, "attendance_type", e.target.value || null)
                      }
                      disabled={future}
                      className="w-[5.5rem] rounded border px-1 py-1 text-xs text-gray-900 disabled:bg-gray-100"
                    >
                      <option value="">—</option>
                      {["出勤", "欠勤", "休日", "有給", "振休", "休日出勤"].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  {TIME_COLUMNS.map((col) => {
                    const rawValue = rawInputs.get(getRawKey(date, col.key));
                    const displayValue = rawValue !== undefined ? rawValue : (report?.[col.key] != null ? minutesToHHMM(report[col.key] as number) : "");
                    return (
                      <td key={col.key} className="px-1 py-1">
                        <div className="relative flex items-center">
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="HH:MM"
                            value={displayValue}
                            onChange={(e) => {
                              setRawInputs((prev) => {
                                const next = new Map(prev);
                                next.set(getRawKey(date, col.key), e.target.value);
                                return next;
                              });
                            }}
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === "") {
                                updateLocal(date, col.key, null);
                              } else {
                                const minutes = hhmmToMinutes(raw);
                                if (minutes !== null) {
                                  updateLocal(date, col.key, minutes);
                                }
                              }
                              setRawInputs((prev) => {
                                const next = new Map(prev);
                                next.delete(getRawKey(date, col.key));
                                return next;
                              });
                            }}
                            disabled={future}
                            className="w-[5rem] rounded border px-2 py-1 text-xs text-gray-900 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 transition-colors hover:border-blue-400"
                          />
                          {displayValue && !future && (
                            <button
                              onClick={() => updateLocal(date, col.key, null)}
                              className="absolute right-1 p-1 text-gray-400 hover:text-red-500"
                              title="時間をクリア"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
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
                  <td className="px-2 py-1 whitespace-nowrap text-gray-700">
                    {formatMinutes(report?.deep_night_minutes)}
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

      {/* 出勤区分 月集計 */}
      <div className="mt-4 rounded-lg border bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-bold text-gray-700">出勤区分 月集計</h3>
        <div className="flex flex-wrap gap-4 text-xs text-gray-700">
          {["出勤", "欠勤", "休日", "有給", "振休", "休日出勤"].map((type) => {
            const count = Array.from(reports.values()).filter(
              (r) => r.attendance_type === type
            ).length;
            return (
              <div key={type} className="flex items-center gap-1">
                <span className="font-medium text-gray-600">{type}:</span>
                <span className="font-bold">{count}日</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
