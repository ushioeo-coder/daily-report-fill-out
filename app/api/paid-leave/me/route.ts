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

  const usedReportRows = Array.isArray(usedReports)
    ? (usedReports as { id: string }[])
    : [];
  const grantRows = Array.isArray(grants)
    ? (grants as { expiry_date: string | Date; granted_days: number | string }[])
    : [];

  const rawUsed = usedReportRows.length; // 全期間の有給取得日数（FIFO計算の入力）
  const today = new Date().toISOString().split("T")[0];

  // ─── FIFO方式で付与ごとに消化日数を割り当て ───────────────────────────
  // 有効期限の古い付与から順に消化日数を割り当てる。
  // 期限切れ年度に消化した分は期限切れ付与から引かれ、有効年度の残日数は守られる。
  const allGrants = [...grantRows];
  allGrants.sort(
    (a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime()
  );

  const buckets = allGrants.map((g) => ({
    expiryStr: new Date(g.expiry_date).toISOString().slice(0, 10),
    granted: Number(g.granted_days),
    remaining: Number(g.granted_days),
  }));

  let leftover = rawUsed;
  for (const bucket of buckets) {
    if (leftover <= 0) break;
    const deduct = Math.min(leftover, bucket.remaining);
    bucket.remaining -= deduct;
    leftover -= deduct;
  }

  const validBuckets = buckets.filter((b) => b.expiryStr >= today);
  const totalGranted = validBuckets.reduce((sum, b) => sum + b.granted, 0);
  const remainingDays = validBuckets.reduce((sum, b) => sum + b.remaining, 0);
  const usedDays = totalGranted - remainingDays;

  return NextResponse.json({
    total_granted: totalGranted,
    used_days: usedDays,
    remaining_days: remainingDays,
  });
}
