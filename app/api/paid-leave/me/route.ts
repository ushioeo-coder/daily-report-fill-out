import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/paid-leave/me
 * ログイン中のユーザー自身の有給残日数・付与情報を返す（一般ユーザーも利用可能）
 */
export async function GET() {
  // セッション確認（ログイン済みか）
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const userId = session.id;

  // 有給付与一覧を取得（有効期限の新しい順）
  const { data: grants, error: grantsError } = await supabase
    .from("paid_leave_grants")
    .select("id, grant_date, granted_days, expiry_date, note")
    .eq("user_id", userId)
    .order("grant_date", { ascending: false });

  if (grantsError) {
    return NextResponse.json(
      { error: "有給付与情報の取得に失敗しました。" },
      { status: 500 }
    );
  }

  // 有給取得済み日数（出勤区分が「有給」の日報件数）
  const { data: usedReports, error: usedError } = await supabase
    .from("daily_reports")
    .select("id")
    .eq("user_id", userId)
    .eq("attendance_type", "有給");

  if (usedError) {
    return NextResponse.json(
      { error: "有給取得情報の取得に失敗しました。" },
      { status: 500 }
    );
  }

  const usedDays = usedReports?.length ?? 0;
  const today = new Date().toISOString().split("T")[0];

  // 有効期限内の付与のみ合計
  type GrantRow = { expiry_date: string; granted_days: number | string };
  const validGrants = (grants ?? []).filter(
    (g: GrantRow) => g.expiry_date >= today
  );
  const totalGranted = validGrants.reduce(
    (sum: number, g: GrantRow) => sum + Number(g.granted_days),
    0
  );
  const remainingDays = Math.max(totalGranted - usedDays, 0);

  return NextResponse.json({
    total_granted: totalGranted,
    used_days: usedDays,
    remaining_days: remainingDays,
  });
}
