"use client";

import { useEffect, useState } from "react";

async function downloadBlob(res: Response, fallback: string) {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename\*=UTF-8''(.+)/);
  a.download = match ? decodeURIComponent(match[1]) : fallback;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}

type User = {
  id: string;
  employee_id: string;
  name: string;
};

type Grant = {
  id: string;
  grant_date: string;
  granted_days: number;
  expiry_date: string;
  note?: string | null;
};

export default function AdminExportPage() {
  const today = new Date();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ─── 有給休暇管理簿用の state ──────────────────────────────────
  const [leaveUserId, setLeaveUserId] = useState("");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [selectedGrantId, setSelectedGrantId] = useState("");
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveError, setLeaveError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/users");
      if (!res.ok) return;
      const data: User[] = await res.json();
      setUsers(data);
      if (data.length > 0) setSelectedUserId("all");
    })();
  }, []);

  // 有給管理簿: ユーザー選択時に付与一覧を取得
  // AbortController で、素早く切り替えた時に古いリクエストの結果が後から反映されるのを防ぐ
  useEffect(() => {
    if (!leaveUserId) {
      setGrants([]);
      setSelectedGrantId("");
      return;
    }
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/paid-leave?user_id=${leaveUserId}`, {
          signal: ac.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        const grantList: Grant[] = data.grants || [];
        setGrants(grantList);
        if (grantList.length > 0) setSelectedGrantId(grantList[0].id);
        else setSelectedGrantId("");
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        throw e;
      }
    })();
    return () => ac.abort();
  }, [leaveUserId]);

  async function handleExport() {
    if (!selectedUserId) return;
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/reports/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUserId, year, month }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "出力に失敗しました。");
        return;
      }

      await downloadBlob(res, "日報.xlsx");
    } catch {
      setError("通信エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  async function handleLeaveExport() {
    if (!leaveUserId || !selectedGrantId) return;
    setLeaveError("");
    setLeaveLoading(true);

    try {
      const res = await fetch("/api/reports/export-leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: leaveUserId,
          grant_id: selectedGrantId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setLeaveError(data.error ?? "出力に失敗しました。");
        return;
      }

      await downloadBlob(res, "有給休暇管理簿.xlsx");
    } catch {
      setLeaveError("通信エラーが発生しました。");
    } finally {
      setLeaveLoading(false);
    }
  }

  function formatGrantLabel(g: Grant): string {
    const d = new Date(g.grant_date);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日付与 (${g.granted_days}日)`;
  }

  return (
    <div className="max-w-md">
      <h2 className="mb-6 text-lg font-bold text-gray-800">Excel 出力</h2>

      {/* ─── 月別日報 Excel 出力 ──────────────────────────────── */}
      <div className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-600">月別日報</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            社員
          </label>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
          >
            <option value="all">全ユーザーを一括出力 (シート分割)</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.employee_id} - {u.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700">
              年
            </label>
            <input
              type="number"
              value={year}
              min={2020}
              max={2099}
              onChange={(e) => setYear(Number(e.target.value))}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700">
              月
            </label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {m}月
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          onClick={handleExport}
          disabled={loading || !selectedUserId}
          className="w-full rounded bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? "生成中..." : "Excel をダウンロード"}
        </button>
      </div>

      {/* ─── 有給休暇管理簿 出力 ──────────────────────────────── */}
      <div className="mt-6 space-y-4 rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-600">
          有給休暇管理簿
        </h3>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            社員
          </label>
          <select
            value={leaveUserId}
            onChange={(e) => setLeaveUserId(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
          >
            <option value="">選択してください</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.employee_id} - {u.name}
              </option>
            ))}
          </select>
        </div>

        {leaveUserId && (
          <div>
            <label className="block text-sm font-medium text-gray-700">
              付与期間
            </label>
            {grants.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500">
                有給付与記録がありません。
              </p>
            ) : (
              <select
                value={selectedGrantId}
                onChange={(e) => setSelectedGrantId(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
              >
                {grants.map((g) => (
                  <option key={g.id} value={g.id}>
                    {formatGrantLabel(g)}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {leaveError && (
          <p className="text-sm text-red-600" role="alert">
            {leaveError}
          </p>
        )}

        <button
          onClick={handleLeaveExport}
          disabled={leaveLoading || !leaveUserId || !selectedGrantId}
          className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {leaveLoading ? "生成中..." : "有給管理簿をダウンロード"}
        </button>
      </div>
    </div>
  );
}
