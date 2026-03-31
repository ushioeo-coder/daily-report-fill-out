// サーバーコンポーネント: 法定休日をDBから直接取得してクライアントに渡す
// force-dynamic: キャッシュを使わず毎回DBから最新データを取得する
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import ReportsClient from "./ReportsClient";

export default async function ReportsPage() {
  // 管理者がこのページにアクセスした場合、管理者用の日報一覧にリダイレクト
  const session = await getSession();
  if (session?.role === "admin") {
    redirect("/admin/reports");
  }
  // 現在の年月を取得
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const paddedMonth = String(month).padStart(2, "0");
  const prefix = `${year}-${paddedMonth}-`; // "2026-03-" のような形式

  // 全法定休日をDBから取得し、該当月分のみに絞る（日付比較の方法を問わず確実に動作）
  const { data, error } = await supabase
    .from("company_holidays")
    .select("holiday_date");

  if (error) {
    console.error("[ReportsPage] 法定休日の取得に失敗:", error.message);
  }

  // 当月分のみ抽出 & "YYYY-MM-DD" 形式に正規化
  const initialHolidays: string[] = (data ?? [])
    .map((row: { holiday_date: string | Date }) =>
      typeof row.holiday_date === "string"
        ? row.holiday_date.slice(0, 10)
        : new Date(row.holiday_date).toISOString().slice(0, 10)
    )
    .filter((d: string) => d.startsWith(prefix));


  // クライアントコンポーネントに初期休日データを渡す
  return <ReportsClient initialHolidays={initialHolidays} />;
}
