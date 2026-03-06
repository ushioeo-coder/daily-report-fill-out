"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MaintenancePage() {
    const router = useRouter();
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);
    const [bulkDeleteStart, setBulkDeleteStart] = useState("");
    const [bulkDeleteEnd, setBulkDeleteEnd] = useState("");
    const [message, setMessage] = useState("");
    const [messageType, setMessageType] = useState<"info" | "error">("info");

    async function handleBulkDelete() {
        if (!bulkDeleteStart || !bulkDeleteEnd) {
            alert("開始日と終了日を指定してください。");
            return;
        }
        if (
            !confirm(
                `${bulkDeleteStart} から ${bulkDeleteEnd} までの全ユーザーの日報を一括削除します。よろしいですか？\n※この操作は取り消せません。`
            )
        ) {
            return;
        }

        setIsBulkDeleting(true);
        setMessage("");

        try {
            const res = await fetch("/api/reports/bulk-delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    startDate: bulkDeleteStart,
                    endDate: bulkDeleteEnd,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                setMessage(data.error ?? "削除に失敗しました。");
                setMessageType("error");
                return;
            }

            setMessage("指定期間の日報を削除しました。");
            setMessageType("info");
            setBulkDeleteStart("");
            setBulkDeleteEnd("");
        } catch {
            setMessage("通信エラーが発生しました。");
            setMessageType("error");
        } finally {
            setIsBulkDeleting(false);
        }
    }

    return (
        <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-2xl font-bold text-gray-800">データメンテナンス</h2>

            <div className="rounded-lg border border-red-100 bg-white p-6 shadow-sm">
                <h3 className="mb-2 text-lg font-bold text-red-700">日報データの一括削除</h3>
                <p className="mb-6 text-sm text-gray-600">
                    指定した期間内の全ユーザーの日報データをデータベースから完全に削除します。
                    <br />
                    <span className="font-bold text-red-600">※実行前に必ずExcel出力などでバックアップを保存してください。削除したデータは復元できません。</span>
                </p>

                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-4">
                        <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1">開始日</label>
                            <input
                                type="date"
                                value={bulkDeleteStart}
                                onChange={(e) => setBulkDeleteStart(e.target.value)}
                                className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                            />
                        </div>
                        <span className="mt-5 text-gray-400">〜</span>
                        <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1">終了日</label>
                            <input
                                type="date"
                                value={bulkDeleteEnd}
                                onChange={(e) => setBulkDeleteEnd(e.target.value)}
                                className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                            />
                        </div>
                    </div>

                    {message && (
                        <div
                            className={`rounded p-3 text-sm ${messageType === "error" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"
                                }`}
                        >
                            {message}
                        </div>
                    )}

                    <div className="mt-2 flex justify-end">
                        <button
                            onClick={handleBulkDelete}
                            disabled={isBulkDeleting}
                            className="rounded bg-red-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
                        >
                            {isBulkDeleting ? "削除実行中..." : "日報データを一括削除する"}
                        </button>
                    </div>
                </div>
            </div>

            <div className="mt-8 text-center text-sm text-gray-400">
                <button
                    onClick={() => router.back()}
                    className="hover:text-gray-600 hover:underline"
                >
                    前の画面に戻る
                </button>
            </div>
        </div>
    );
}
