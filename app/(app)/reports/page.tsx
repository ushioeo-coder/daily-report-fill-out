"use client";

import { useEffect, useState, useCallback } from "react";
import { minutesToHHMM, hhmmToMinutes } from "@/lib/time";

type Report = {
  id?: string;
  report_date: string;
  start_time: number | null;
  end_time: number | null;
  note: string | null;
};

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

export default function ReportsPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [reports, setReports] = useState<Map<string, Report>>(new Map());
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const days = getDaysInMonth(year, month);
  const from = days[0];
  const to = days[days.length - 1];

  const fetchReports = useCallback(async () => {
    const res = await fetch(`/api/reports?from=${from}&to=${to}`);
    if (!res.ok) return;
    const data: Report[] = await res.json();
    const map = new Map<string, Report>();
    for (const r of data) {
      map.set(r.report_date, r);
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
        start_time: null,
        end_time: null,
        note: null,
      };
      next.set(date, { ...existing, [field]: value });
      return next;
    });
  }

  async function saveRow(date: string) {
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
          end_time: report.end_time,
          note: report.note || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setMessage(data.error ?? "保存に失敗しました。");
        return;
      }

      const saved: Report = await res.json();
      setReports((prev) => {
        const next = new Map(prev);
        next.set(date, saved);
        return next;
      });
      setMessage(`${date} を保存しました。`);
    } catch {
      setMessage("通信エラーが発生しました。");
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
        <p className="mb-3 text-sm text-blue-600">{message}</p>
      )}

      {/* 日報テーブル */}
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-600">
              <th className="px-3 py-2 whitespace-nowrap">日付</th>
              <th className="px-3 py-2 whitespace-nowrap">曜日</th>
              <th className="px-3 py-2 whitespace-nowrap">出勤</th>
              <th className="px-3 py-2 whitespace-nowrap">退勤</th>
              <th className="px-3 py-2">備考</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {days.map((date) => {
              const report = reports.get(date);
              const weekday = getWeekday(date);
              const weekend = isWeekend(date);
              const dayNum = date.split("-")[2];

              return (
                <tr
                  key={date}
                  className={`border-b ${weekend ? "bg-gray-50 text-gray-400" : ""}`}
                >
                  <td className="px-3 py-1.5 whitespace-nowrap">{dayNum}</td>
                  <td
                    className={`px-3 py-1.5 whitespace-nowrap ${
                      weekday === "日"
                        ? "text-red-500"
                        : weekday === "土"
                          ? "text-blue-500"
                          : ""
                    }`}
                  >
                    {weekday}
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="time"
                      value={
                        report?.start_time != null
                          ? minutesToHHMM(report.start_time)
                          : ""
                      }
                      onChange={(e) => {
                        const mins = hhmmToMinutes(e.target.value);
                        updateLocal(date, "start_time", mins);
                      }}
                      className="rounded border px-2 py-1 text-sm text-gray-900"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="time"
                      value={
                        report?.end_time != null
                          ? minutesToHHMM(report.end_time)
                          : ""
                      }
                      onChange={(e) => {
                        const mins = hhmmToMinutes(e.target.value);
                        updateLocal(date, "end_time", mins);
                      }}
                      className="rounded border px-2 py-1 text-sm text-gray-900"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={report?.note ?? ""}
                      onChange={(e) =>
                        updateLocal(date, "note", e.target.value)
                      }
                      placeholder="備考"
                      className="w-full rounded border px-2 py-1 text-sm text-gray-900 placeholder-gray-300"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      onClick={() => saveRow(date)}
                      disabled={saving === date}
                      className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
