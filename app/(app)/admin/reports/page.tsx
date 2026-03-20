"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  holiday_work_minutes?: number | null;
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

const EMPTY_REPORT_FIELDS = {
  attendance_type: null as string | null,
  start_time: null as number | null,
  site_arrival_time: null as number | null,
  work_start_time: null as number | null,
  work_end_time: null as number | null,
  return_time: null as number | null,
  end_time: null as number | null,
  note: null as string | null,
};

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

function getRawKey(date: string, field: string) {
  return `${date}__${field}`;
}

export default function AdminReportsPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [reports, setReports] = useState<Map<string, Report>>(new Map());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "error">("info");
  const [rawInputs, setRawInputs] = useState<Map<string, string>>(new Map());
  // 変更済みの日付を追跡
  const [dirtyDates, setDirtyDates] = useState<Set<string>>(new Set());

  // 選択中ユーザーの有給残日数
  const [paidLeave, setPaidLeave] = useState<{
    total_granted: number;
    used_days: number;
    remaining_days: number;
  } | null>(null);

  // useRef: レンダリングをまたいで常に最新の値を保持する（クロージャ問題を防ぐ）
  const reportsRef = useRef(reports);
  const rawInputsRef = useRef(rawInputs);
  const dirtyDatesRef = useRef(dirtyDates);
  reportsRef.current = reports;
  rawInputsRef.current = rawInputs;
  dirtyDatesRef.current = dirtyDates;

  // 時刻ダイヤルの状態
  const [picker, setPicker] = useState<{
    date: string;
    field: keyof Report;
    h: number;
    m: number;
  } | null>(null);

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
      if (data.length > 0) {
        setSelectedUserId(data[0].id);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 選択ユーザーの有給残日数を取得
  useEffect(() => {
    if (!selectedUserId) return;
    (async () => {
      const res = await fetch(`/api/paid-leave?user_id=${selectedUserId}`);
      if (!res.ok) { setPaidLeave(null); return; }
      const data = await res.json();
      setPaidLeave({
        total_granted: data.total_granted ?? 0,
        used_days: data.used_days ?? 0,
        remaining_days: data.remaining_days ?? 0,
      });
    })();
  }, [selectedUserId]);

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
    // refも同期
    reportsRef.current = map;
    setReports(map);
  }, [from, to, selectedUserId]);

  useEffect(() => {
    fetchReports();
    // ユーザー・月が変わったら未保存状態もリセット
    dirtyDatesRef.current = new Set();
    rawInputsRef.current = new Map();
    setDirtyDates(new Set());
    setRawInputs(new Map());
  }, [fetchReports]);

  function prevMonth() {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  }

  function nextMonth() {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  }

  /** 時刻ダイヤルを開く */
  function openPicker(date: string, field: keyof Report, currentMinutes: number | null) {
    const total = currentMinutes ?? 0;
    setPicker({ date, field, h: Math.floor(total / 60), m: total % 60 });
  }

  function updateLocal(date: string, field: keyof Report, value: string | number | null) {
    // refを即座に更新（saveAll が確実に最新値を使えるようにする）
    const existing = reportsRef.current.get(date) ?? {
      user_id: selectedUserId,
      report_date: date,
      ...EMPTY_REPORT_FIELDS,
    };
    const updated = { ...existing, [field]: value };
    reportsRef.current = new Map(reportsRef.current);
    reportsRef.current.set(date, updated);
    dirtyDatesRef.current = new Set(dirtyDatesRef.current).add(date);

    // React state も更新（画面の再描画のため）
    setReports((prev) => {
      const next = new Map(prev);
      next.set(date, updated);
      return next;
    });
    setDirtyDates((prev) => new Set(prev).add(date));
  }

  /**
   * 指定日の送信ペイロードを作成する。
   * ref（常に最新値）から読む。rawInputs（入力中テキスト）があれば優先する。
   */
  function buildRowPayload(date: string) {
    const report = reportsRef.current.get(date) ?? {
      user_id: selectedUserId,
      report_date: date,
      ...EMPTY_REPORT_FIELDS,
    };
    const timeFields: Record<string, number | null> = {};
    for (const col of TIME_COLUMNS) {
      const raw = rawInputsRef.current.get(getRawKey(date, col.key));
      if (raw !== undefined) {
        const trimmed = raw.trim();
        timeFields[col.key] = trimmed === "" ? null : (hhmmToMinutes(trimmed) ?? (report[col.key] as number | null));
      } else {
        timeFields[col.key] = report[col.key] as number | null;
      }
    }
    return {
      report_date: date,
      attendance_type: report.attendance_type ?? null,
      user_id: selectedUserId,
      ...timeFields,
      note: report.note || null,
    };
  }

  /** 変更済みの全行を一括保存する */
  async function saveAll() {
    if (!selectedUserId) return;

    // ref から読む（常に最新の状態を参照するため）
    const rawInputDates = new Set<string>();
    for (const key of rawInputsRef.current.keys()) {
      rawInputDates.add(key.split("__")[0]);
    }
    const datesToSave = [...new Set([...dirtyDatesRef.current, ...rawInputDates])].filter(
      (d) => !isFutureDate(d)
    );

    if (datesToSave.length === 0) {
      setMessage("変更はありません。");
      setMessageType("info");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const results = await Promise.all(
        datesToSave.map((date) =>
          fetch("/api/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildRowPayload(date)),
          })
        )
      );

      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        const data = await failed[0].json();
        setMessage(data.error ?? "一部の保存に失敗しました。");
        setMessageType("error");
        return;
      }

      await fetchReports();
      dirtyDatesRef.current = new Set();
      rawInputsRef.current = new Map();
      setDirtyDates(new Set());
      setRawInputs(new Map());
      setMessage(`${datesToSave.length}件 を保存しました。`);
      setMessageType("info");
    } catch {
      setMessage("通信エラーが発生しました。");
      setMessageType("error");
    } finally {
      setSaving(false);
    }
  }

  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <div>
      {/* ユーザー選択 + 月ナビゲーション */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
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

        <button onClick={prevMonth} className="rounded border px-3 py-1 text-sm hover:bg-gray-100">前月</button>
        <h2 className="text-lg font-bold text-gray-800">{year}年{month}月</h2>
        <button onClick={nextMonth} className="rounded border px-3 py-1 text-sm hover:bg-gray-100">翌月</button>

        {selectedUser && (
          <span className="text-sm font-medium text-gray-700">
            {selectedUser.name} さんの日報
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {dirtyDates.size > 0 && (
            <span className="text-xs text-amber-600 font-medium">
              {dirtyDates.size}件 未保存
            </span>
          )}
          <button
            onClick={saveAll}
            disabled={saving}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "一括保存"}
          </button>
        </div>
      </div>

      {message && (
        <p className={`mb-3 text-sm ${messageType === "error" ? "text-red-600" : "text-blue-600"}`}>
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
                <th key={col.key} className="px-1 py-2 whitespace-nowrap">{col.label}</th>
              ))}
              <th className="px-2 py-2 whitespace-nowrap">現場外</th>
              <th className="px-2 py-2 whitespace-nowrap">現場作業</th>
              <th className="px-2 py-2 whitespace-nowrap">残業</th>
              <th className="px-2 py-2 whitespace-nowrap">深夜勤務</th>
              <th className="px-2 py-2 whitespace-nowrap">休日出勤</th>
              <th className="px-2 py-2">備考</th>
            </tr>
          </thead>
          <tbody>
            {days.map((date) => {
              const report = reports.get(date);
              const weekday = getWeekday(date);
              const weekend = isWeekend(date);
              const future = isFutureDate(date);
              const dayNum = date.split("-")[2];
              const dirty = dirtyDates.has(date);

              return (
                <tr
                  key={date}
                  className={`border-b ${dirty ? "bg-amber-50" : weekend ? "bg-gray-50 text-gray-400" : ""} ${future ? "opacity-50" : ""}`}
                >
                  <td className="px-2 py-1 whitespace-nowrap">{dayNum}</td>
                  <td
                    className={`px-2 py-1 whitespace-nowrap ${weekday === "日" ? "text-red-500" : weekday === "土" ? "text-blue-500" : ""}`}
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
                    const displayValue = rawValue !== undefined
                      ? rawValue
                      : (report?.[col.key] != null ? minutesToHHMM(report[col.key] as number) : "");
                    return (
                      <td key={col.key} className="px-1 py-1">
                        <div className="relative flex items-center">
                          {/* 時計アイコン（クリックでダイヤルを表示） */}
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className={`absolute left-1.5 z-10 h-3 w-3 transition-colors ${future ? "text-gray-300 cursor-default" : "text-gray-400 cursor-pointer hover:text-blue-500"}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            onClick={() => {
                              if (!future) openPicker(date, col.key, report?.[col.key] as number | null);
                            }}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
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
                            className="w-[5.5rem] rounded border pl-5 pr-1 py-1 text-xs text-gray-900 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 transition-colors hover:border-blue-400"
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
                  <td className="px-2 py-1 whitespace-nowrap text-gray-700">
                    {formatMinutes(report?.holiday_work_minutes)}
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={report?.note ?? ""}
                      onChange={(e) => updateLocal(date, "note", e.target.value)}
                      disabled={future}
                      placeholder="備考"
                      className="w-full min-w-[5rem] rounded border px-1.5 py-0.5 text-xs text-gray-900 placeholder-gray-300 disabled:bg-gray-100"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {(() => {
              const allReports = Array.from(reports.values());
              const sumTravel    = allReports.reduce((acc, r) => acc + (r.travel_office_minutes ?? 0), 0);
              const sumSite      = allReports.reduce((acc, r) => acc + (r.site_work_minutes ?? 0), 0);
              const sumOvertime  = allReports.reduce((acc, r) => acc + (r.overtime_minutes ?? 0), 0);
              const sumDeepNight = allReports.reduce((acc, r) => acc + (r.deep_night_minutes ?? 0), 0);
              const sumHoliday   = allReports.reduce((acc, r) => acc + (r.holiday_work_minutes ?? 0), 0);
              return (
                <tr className="border-t-2 border-gray-300 bg-gray-100 font-bold text-xs text-gray-700">
                  {/* 日・曜・出勤区分・時刻6列 の空白（合計9セル） */}
                  <td className="px-2 py-1 text-right text-gray-500" colSpan={9}>合計</td>
                  <td className="px-2 py-1 whitespace-nowrap">{formatMinutes(sumTravel)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{formatMinutes(sumSite)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{formatMinutes(sumOvertime)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{formatMinutes(sumDeepNight)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{formatMinutes(sumHoliday)}</td>
                  <td className="px-2 py-1"></td>
                </tr>
              );
            })()}
          </tfoot>
        </table>
      </div>

      {/* 出勤区分 月集計 + 有給残日数 */}
      <div className="mt-4 flex flex-wrap gap-4">
        {/* 出勤区分別カウント */}
        <div className="flex-1 rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-bold text-gray-700">
            {selectedUser ? `${selectedUser.name} さん ` : ""}出勤区分 月集計
          </h3>
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

        {/* 有給残日数バッジ: 付与が1日以上あるユーザーのみ表示 */}
        {paidLeave !== null && paidLeave.total_granted > 0 && (
          <div
            className={`min-w-[160px] rounded-lg border p-4 shadow-sm text-center ${
              paidLeave.remaining_days === 0
                ? "border-red-300 bg-red-50"
                : paidLeave.remaining_days <= 3
                ? "border-yellow-300 bg-yellow-50"
                : "border-green-300 bg-green-50"
            }`}
          >
            <div className="mb-1 text-xs font-bold text-gray-600">有給残日数</div>
            <div
              className={`text-3xl font-extrabold ${
                paidLeave.remaining_days === 0
                  ? "text-red-600"
                  : paidLeave.remaining_days <= 3
                  ? "text-yellow-600"
                  : "text-green-600"
              }`}
            >
              {paidLeave.remaining_days}
              <span className="text-base font-bold"> 日</span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              （付与 {paidLeave.total_granted}日 / 取得済 {paidLeave.used_days}日）
            </div>
            {paidLeave.remaining_days === 0 && (
              <div className="mt-1 text-xs text-red-500">有給残日数がありません</div>
            )}
          </div>
        )}
      </div>

      {/* 時刻ダイヤル モーダル */}
      {picker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setPicker(null)}
        >
          <div
            className="rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-sm font-bold text-gray-700">時刻を選択</h3>
            <div className="flex items-center gap-3">
              {/* 時セレクター（0〜29: 深夜帯は29時=翌5:00まで、それ以降は通常表記） */}
              <div className="flex flex-col items-center">
                <label className="mb-1 text-xs text-gray-500">時</label>
                <select
                  value={picker.h}
                  onChange={(e) => setPicker({ ...picker, h: Number(e.target.value) })}
                  className="h-32 w-16 rounded border px-1 text-center text-sm text-gray-900"
                  size={5}
                >
                  {Array.from({ length: 30 }, (_, i) => (
                    <option key={i} value={i}>
                      {i <= 24 ? String(i).padStart(2, "0") : `${String(i).padStart(2, "0")}(${i - 24})`}
                    </option>
                  ))}
                </select>
              </div>
              <span className="text-xl font-bold text-gray-600 pb-1">:</span>
              {/* 分セレクター（5分刻み） */}
              <div className="flex flex-col items-center">
                <label className="mb-1 text-xs text-gray-500">分</label>
                <select
                  value={picker.m}
                  onChange={(e) => setPicker({ ...picker, m: Number(e.target.value) })}
                  className="h-32 w-16 rounded border px-1 text-center text-sm text-gray-900"
                  size={5}
                >
                  {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                    <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPicker(null)}
                className="rounded border px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  updateLocal(picker.date, picker.field, picker.h * 60 + picker.m);
                  setPicker(null);
                }}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
