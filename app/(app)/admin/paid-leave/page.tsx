"use client";

import { useState, useEffect, useCallback } from "react";

// 社員情報の型定義
type User = { id: string; employee_id: string; name: string };

// 有給付与レコードの型定義
type Grant = {
  id: string;
  grant_date: string;
  granted_days: number;
  expiry_date: string;
  note: string | null;
};

// APIから返ってくる有給情報の型定義
type PaidLeaveInfo = {
  grants: Grant[];
  used_days: number;
  total_granted: number;
  remaining_days: number;
};

/** "2026-03-01T00:00:00.000Z" や "2026-03-01" を "2026年3月1日" に変換 */
function formatDate(raw: string): string {
  const s = raw.slice(0, 10); // YYYY-MM-DD だけ取り出す
  const [y, m, d] = s.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

export default function PaidLeavePage() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [info, setInfo] = useState<PaidLeaveInfo | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "error">("info");
  const [deleting, setDeleting] = useState<string | null>(null); // 削除中の grant id
  const [submitting, setSubmitting] = useState(false);

  // 新規付与フォームの入力値
  const [grantDate, setGrantDate] = useState("");
  const [grantedDays, setGrantedDays] = useState("10");
  const [expiryDate, setExpiryDate] = useState("");
  const [grantNote, setGrantNote] = useState("");

  // 画面表示時に社員一覧を取得
  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then(setUsers);
  }, []);

  // 選択中の社員の有給情報を取得
  const fetchInfo = useCallback(async () => {
    if (!selectedUserId) return;
    const res = await fetch(`/api/paid-leave?user_id=${selectedUserId}`);
    if (res.ok) setInfo(await res.json());
  }, [selectedUserId]);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  // 有給付与を登録する
  async function addGrant() {
    setMessage("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/paid-leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: selectedUserId,
          grant_date: grantDate,
          granted_days: Number(grantedDays),
          expiry_date: expiryDate,
          note: grantNote || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setMessage(d.error ?? "登録に失敗しました。");
        setMessageType("error");
        return;
      }
      setMessage("有給を付与しました。");
      setMessageType("info");
      setGrantDate("");
      setGrantedDays("10");
      setExpiryDate("");
      setGrantNote("");
      await fetchInfo();
    } finally {
      setSubmitting(false);
    }
  }

  // 付与記録を削除する
  async function deleteGrant(id: string) {
    if (!confirm("この付与記録を削除しますか？")) return;
    setMessage("");
    setDeleting(id);
    try {
      const res = await fetch(`/api/paid-leave?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        setMessage("削除に失敗しました。");
        setMessageType("error");
        return;
      }
      setMessage("削除しました。");
      setMessageType("info");
      await fetchInfo();
    } finally {
      setDeleting(null);
    }
  }

  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-bold text-gray-800">有給管理</h1>
      <p className="mb-6 text-xs text-gray-500">社員の有給付与・残日数の確認・管理ができます。</p>

      {/* 社員選択カード */}
      <div className="mb-6 rounded-xl border bg-white p-5 shadow-sm">
        <label className="mb-2 block text-sm font-semibold text-gray-700">
          対象社員を選択
        </label>
        <select
          value={selectedUserId}
          onChange={(e) => {
            setSelectedUserId(e.target.value);
            setInfo(null);
            setMessage("");
          }}
          className="w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">— 社員を選択してください —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.employee_id}　{u.name}
            </option>
          ))}
        </select>
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

      {/* 社員を選択した後に表示 */}
      {selectedUserId && info && (
        <>
          {/* 残日数サマリーカード */}
          <div className="mb-6 grid grid-cols-3 gap-4">
            <div className="rounded-xl border bg-white p-4 shadow-sm text-center">
              <div className="mb-1 text-xs text-gray-500">付与合計（有効期限内）</div>
              <div className="text-2xl font-extrabold text-gray-800">
                {info.total_granted}
                <span className="ml-1 text-sm font-normal text-gray-500">日</span>
              </div>
            </div>
            <div className="rounded-xl border bg-white p-4 shadow-sm text-center">
              <div className="mb-1 text-xs text-gray-500">取得済み</div>
              <div className="text-2xl font-extrabold text-gray-800">
                {info.used_days}
                <span className="ml-1 text-sm font-normal text-gray-500">日</span>
              </div>
            </div>
            <div className={`rounded-xl border p-4 shadow-sm text-center ${
              info.remaining_days === 0
                ? "border-red-300 bg-red-50"
                : info.remaining_days <= 3
                  ? "border-amber-300 bg-amber-50"
                  : "border-green-300 bg-green-50"
            }`}>
              <div className="mb-1 text-xs text-gray-500">残日数</div>
              <div className={`text-2xl font-extrabold ${
                info.remaining_days === 0
                  ? "text-red-600"
                  : info.remaining_days <= 3
                    ? "text-amber-600"
                    : "text-green-700"
              }`}>
                {info.remaining_days}
                <span className="ml-1 text-sm font-normal text-gray-500">日</span>
              </div>
            </div>
          </div>

          {/* 付与履歴テーブル */}
          <div className="mb-6 rounded-xl border bg-white shadow-sm overflow-hidden">
            <div className="border-b bg-gray-50 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-700">
                付与履歴
                {selectedUser && (
                  <span className="ml-2 font-normal text-gray-500">
                    {selectedUser.employee_id}　{selectedUser.name}
                  </span>
                )}
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">付与年月日</th>
                  <th className="px-4 py-2">付与日数</th>
                  <th className="px-4 py-2">有効期限</th>
                  <th className="px-4 py-2">状態</th>
                  <th className="px-4 py-2">備考</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {info.grants.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">
                      付与記録がありません
                    </td>
                  </tr>
                )}
                {info.grants.map((g) => {
                  const today = new Date().toISOString().slice(0, 10);
                  const expired = g.expiry_date.slice(0, 10) < today;
                  return (
                    <tr key={g.id} className={`border-b last:border-0 ${expired ? "opacity-50" : ""}`}>
                      <td className="px-4 py-3 text-gray-800">{formatDate(g.grant_date)}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800">{Number(g.granted_days)}日</td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(g.expiry_date)}</td>
                      <td className="px-4 py-3">
                        {expired ? (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">期限切れ</span>
                        ) : (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">有効</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{g.note ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => deleteGrant(g.id)}
                          disabled={deleting === g.id}
                          className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                        >
                          {deleting === g.id ? "削除中..." : "削除"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 新規付与フォーム */}
          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-700">
              有給を新規付与
              {selectedUser && (
                <span className="ml-2 font-normal text-gray-500">
                  → {selectedUser.name} さんへ
                </span>
              )}
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  付与年月日 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={grantDate}
                  onChange={(e) => setGrantDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  付与日数 <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="40"
                  value={grantedDays}
                  onChange={(e) => setGrantedDays(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  有効期限 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  備考（任意）
                </label>
                <input
                  type="text"
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="例: 2026年度付与分"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={addGrant}
                disabled={!grantDate || !expiryDate || submitting}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none transition-colors"
              >
                {submitting ? "登録中..." : "付与登録"}
              </button>
              <span className="text-xs text-gray-400">
                ＊付与年月日・付与日数・有効期限は必須です
              </span>
            </div>
          </div>
        </>
      )}

      {/* 社員未選択時のプレースホルダー */}
      {!selectedUserId && (
        <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-white py-16 text-sm text-gray-400">
          社員を選択すると有給情報が表示されます
        </div>
      )}
    </div>
  );
}
