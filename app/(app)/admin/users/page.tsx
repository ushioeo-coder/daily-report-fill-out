"use client";

import { useEffect, useState, type FormEvent } from "react";

type User = {
  id: string;
  employee_id: string;
  name: string;
  role: string;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function fetchUsers() {
    const res = await fetch("/api/users");
    if (res.ok) setUsers(await res.json());
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          name,
          password,
          role,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "登録に失敗しました。");
        return;
      }

      setMessage(`${data.employee_id} - ${data.name} を登録しました。`);
      setEmployeeId("");
      setName("");
      setPassword("");
      setRole("user");
      await fetchUsers();
    } catch {
      setError("通信エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(user: User) {
    if (!confirm(`${user.employee_id} - ${user.name} を削除しますか？\n関連する日報データもすべて削除されます。`)) {
      return;
    }

    setMessage("");
    setError("");

    const res = await fetch(`/api/users?id=${user.id}`, { method: "DELETE" });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "削除に失敗しました。");
      return;
    }

    setMessage(`${user.employee_id} - ${user.name} を削除しました。`);
    await fetchUsers();
  }

  return (
    <div>
      <h2 className="mb-6 text-lg font-bold text-gray-800">ユーザー管理</h2>

      <div className="mb-8 rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="mb-4 font-bold text-gray-700">新規登録</h3>
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="block text-xs text-gray-600">社員番号</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                required
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="0001"
                className="mt-1 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600">氏名</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="山田太郎"
                className="mt-1 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600">パスワード</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600">権限</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mt-1 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900"
              >
                <option value="user">一般</option>
                <option value="admin">管理者</option>
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-green-600">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "登録中..." : "登録"}
          </button>
        </form>
      </div>

      {/* ユーザー一覧 */}
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-600">
              <th className="px-4 py-2">社員番号</th>
              <th className="px-4 py-2">氏名</th>
              <th className="px-4 py-2">権限</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="px-4 py-2 text-gray-900">{u.employee_id}</td>
                <td className="px-4 py-2 text-gray-900">{u.name}</td>
                <td className="px-4 py-2 text-gray-600">
                  {u.role === "admin" ? "管理者" : "一般"}
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => handleDelete(u)}
                    className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
