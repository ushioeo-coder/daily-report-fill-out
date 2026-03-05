"use client";

import { useState, type FormEvent, type ReactNode } from "react";

export function AdminAuthGate({ children }: { children: ReactNode }) {
  const [verified, setVerified] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("admin_verified") === "true";
    }
    return false;
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (verified) return <>{children}</>;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "認証に失敗しました。");
        return;
      }
      sessionStorage.setItem("admin_verified", "true");
      setVerified(true);
    } catch {
      setError("通信エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h2 className="mb-4 text-center text-lg font-bold text-gray-800">
          管理者認証
        </h2>
        <p className="mb-4 text-center text-sm text-gray-600">
          管理者機能を使用するにはパスワードを再入力してください。
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="パスワード"
            className="block w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
            autoFocus
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "確認中..." : "認証"}
          </button>
        </form>
      </div>
    </div>
  );
}
