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

export default function PaidLeavePage() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [info, setInfo] = useState<PaidLeaveInfo | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "error">("info");

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

  // 選択中の社員の有給情報を取得（useCallback で安定した関数参照を保持）
  const fetchInfo = useCallback(async () => {
    if (!selectedUserId) return;
    const res = await fetch(`/api/paid-leave?user_id=${selectedUserId}`);
    if (res.ok) setInfo(await res.json());
  }, [selectedUserId]);

  // 社員が変わるたびに有給情報を再取得
  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  // 有給付与を登録する
  async function addGrant() {
    setMessage("");
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
    // フォームをリセット
    setGrantDate("");
    setGrantedDays("10");
    setExpiryDate("");
    setGrantNote("");
    // 一覧を再取得
    await fetchInfo();
  }

  // 付与記録を削除する
  async function deleteGrant(id: string) {
    setMessage("");
    const res = await fetch(`/api/paid-leave?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      setMessage("削除に失敗しました。");
      setMessageType("error");
      return;
    }
    setMessage("削除しました。");
    setMessageType("info");
    await fetchInfo();
  }

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 text-xl font-bold text-gray-800">有給管理</h1>

      {/* 社員選択ドロップダウン */}
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">
          社員を選択
        </label>
        <select
          value={selectedUserId}
          onChange={(e) => {
            setSelectedUserId(e.target.value);
            setInfo(null);
            setMessage("");
          }}
          className="rounded border px-3 py-2 text-sm"
        >
          <option value="">-- 社員を選択 --</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.employee_id} {u.name}
            </option>
          ))}
        </select>
      </div>

      {/* メッセージ表示（成功・エラー） */}
      {message && (
        <p
          className={`mb-3 text-sm ${
            messageType === "error" ? "text-red-600" : "text-blue-600"
          }`}
        >
          {message}
        </p>
      )}

      {/* 社員を選択した後に表示されるセクション */}
      {info && (
        <>
          {/* 残日数サマリー */}
          <div className="mb-6 flex flex-wrap gap-6 rounded-lg border bg-white p-4 shadow-sm text-sm">
            <div>
              <span className="text-gray-600">付与合計（有効期限内）: </span>
              <span className="font-bold">{info.total_granted}日</span>
            </div>
            <div>
              <span className="text-gray-600">取得済み: </span>
              <span className="font-bold">{info.used_days}日</span>
            </div>
            <div>
              <span className="text-gray-600">残日数: </span>
              <span className="text-lg font-bold text-blue-700">
                {info.remaining_days}日
              </span>
            </div>
          </div>

          {/* 付与一覧テーブル */}
          <div className="mb-6 overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-gray-600">
                  <th className="px-3 py-2">付与年月日</th>
                  <th className="px-3 py-2">付与日数</th>
                  <th className="px-3 py-2">有効期限</th>
                  <th className="px-3 py-2">備考</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {info.grants.map((g) => (
                  <tr key={g.id} className="border-b last:border-0">
                    <td className="px-3 py-2">{g.grant_date}</td>
                    <td className="px-3 py-2">{g.granted_days}日</td>
                    <td className="px-3 py-2">{g.expiry_date}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {g.note ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => deleteGrant(g.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
                {info.grants.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-gray-400"
                    >
                      有給付与記録なし
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 新規付与フォーム */}
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-gray-700">
              有給を新規付与
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-600">
                  付与年月日
                </label>
                <input
                  type="date"
                  value={grantDate}
                  onChange={(e) => setGrantDate(e.target.value)}
                  className="rounded border px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">
                  付与日数
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="40"
                  value={grantedDays}
                  onChange={(e) => setGrantedDays(e.target.value)}
                  className="w-20 rounded border px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">
                  有効期限
                </label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="rounded border px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">
                  備考（任意）
                </label>
                <input
                  type="text"
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                  className="w-40 rounded border px-2 py-1 text-xs"
                  placeholder="例: 2026年度付与分"
                />
              </div>
              <button
                onClick={addGrant}
                disabled={!grantDate || !expiryDate}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                付与登録
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
