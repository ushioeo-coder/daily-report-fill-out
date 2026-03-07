"use client";

import { useEffect, useState } from "react";

type User = {
  id: string;
  employee_id: string;
  name: string;
};

export default function AdminExportPage() {
  const today = new Date();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/users");
      if (!res.ok) return;
      const data: User[] = await res.json();
      setUsers(data);
      if (data.length > 0) setSelectedUserId("all");
    })();
  }, []);

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

      // ファイルをダウンロード
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename\*=UTF-8''(.+)/);
      a.download = match ? decodeURIComponent(match[1]) : "日報.xlsx";
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("通信エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md">
      <h2 className="mb-6 text-lg font-bold text-gray-800">Excel 出力</h2>

      <div className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
        {/* 社員選択 */}
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

        {/* 年月選択 */}
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
    </div>
  );
}
