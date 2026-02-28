"use client";

import { useState, type FormEvent } from "react";

type Props = {
  userId: string;
  userRole: string;
};

export function PasswordChangeButton({ userId, userRole }: Props) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isAdmin = userRole === "admin";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "パスワード変更に失敗しました。");
        return;
      }

      setMessage("パスワードを変更しました。");
      setPassword("");
      setTimeout(() => {
        setOpen(false);
        setMessage("");
      }, 1500);
    } catch {
      setError("通信エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setError(""); setMessage(""); setPassword(""); }}
        className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
      >
        PW変更
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
            <h3 className="mb-4 font-bold text-gray-800">パスワード変更</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-600">新しいパスワード</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isAdmin ? "英数字8文字以上" : "数字4桁"}
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {isAdmin ? "英数字8文字以上" : "数字4桁"}
                </p>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              {message && <p className="text-sm text-green-600">{message}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? "変更中..." : "変更"}
                </button>
                <button
                  type="button"
                  onClick={() => { setOpen(false); setPassword(""); setError(""); setMessage(""); }}
                  className="rounded border px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                >
                  キャンセル
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
