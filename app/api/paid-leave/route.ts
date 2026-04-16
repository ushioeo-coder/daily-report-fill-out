import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { UUID_RE } from "@/lib/validation";

// 日付形式チェック用の正規表現
// 例: "2026-03-17" のような YYYY-MM-DD 形式
const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/**
 * GET /api/paid-leave?user_id=uuid
 * 管理者のみ: 指定社員の有給付与一覧・使用日数・残日数を返す
 */
export async function GET(req: NextRequest) {
  // セッション確認（ログイン済みか）
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }
  // 管理者権限チェック
  if (session.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const userId = req.nextUrl.searchParams.get("user_id");
  if (!userId || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: "有効な user_id が必要です。" }, { status: 400 });
  }

  // 有給付与一覧を取得（新しい順）
  const { data: grants, error: grantsError } = await supabase
    .from("paid_leave_grants")
    .select("id, user_id, grant_date, granted_days, expiry_date, note")
    .eq("user_id", userId)
    .order("grant_date", { ascending: false });

  if (grantsError) {
    return NextResponse.json(
      { error: "有給付与情報の取得に失敗しました。" },
      { status: 500 }
    );
  }

  // 有給取得日数（出勤区分が「有給」の日報件数）
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
    ? (grants as { id: string; user_id: string; grant_date: string | Date; granted_days: number | string; expiry_date: string | Date; note?: string | null }[])
    : [];

  const rawUsed = usedReportRows.length; // 全期間の有給取得日数（FIFO計算の入力）
  const today = new Date().toISOString().split("T")[0];

  // ─── FIFO方式で付与ごとに消化日数を割り当て ───────────────────────────
  // pg ライブラリは date/timestamp 型を JavaScript の Date オブジェクトで返す場合があるため
  // new Date() で正規化してから比較する（文字列との直接比較は型ミスマッチで常に false になる）
  //
  // 考え方（先入れ先出し）:
  //   有効期限の古い付与から順に消化日数を割り当てる。
  //   期限切れ付与を使い切った後、残った消化日数が有効期限内の付与に当たる。
  //   → 期限切れ年度に消化した分は期限切れ付与から引かれ、有効年度の残日数は守られる。
  //
  // 例: 2025年度 10日付与(期限切れ)に5日消化 / 2026年度 10日付与(有効)
  //   → FIFOで2025年度バケツから5日引く → 2026年度バケツは10日まるまま → 残日数 10日
  const allGrants = [...grantRows];
  // 有効期限の古い順（昇順）でソート
  allGrants.sort(
    (a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime()
  );

  // 各付与をバケツとして初期化
  const buckets = allGrants.map((g) => ({
    expiryStr: new Date(g.expiry_date).toISOString().slice(0, 10),
    granted: Number(g.granted_days),
    remaining: Number(g.granted_days),
  }));

  // 消化日数をFIFOで各バケツから引く
  let leftover = rawUsed;
  for (const bucket of buckets) {
    if (leftover <= 0) break;
    const deduct = Math.min(leftover, bucket.remaining);
    bucket.remaining -= deduct;
    leftover -= deduct;
  }

  // 有効期限内のバケツのみで集計
  const validBuckets = buckets.filter((b) => b.expiryStr >= today);
  const totalGranted = validBuckets.reduce((sum, b) => sum + b.granted, 0);
  const remainingDays = validBuckets.reduce((sum, b) => sum + b.remaining, 0);
  // 取得済み = 有効期限内の付与から消化した日数
  const usedDays = totalGranted - remainingDays;

  return NextResponse.json({
    grants: grantRows,
    used_days: usedDays,
    total_granted: totalGranted,
    remaining_days: remainingDays,
  });
}

/**
 * POST /api/paid-leave
 * body: { user_id, grant_date, granted_days, expiry_date, note? }
 * 管理者のみ: 有給付与を登録
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  // リクエストボディ（送られてきたデータ）を解析
  const body = await req.json().catch(() => null);
  const { user_id, grant_date, granted_days, expiry_date, note } = body ?? {};

  // 必須項目チェック
  if (!user_id || !grant_date || granted_days == null || !expiry_date) {
    return NextResponse.json(
      { error: "user_id, grant_date, granted_days, expiry_date は必須です。" },
      { status: 400 }
    );
  }
  if (!UUID_RE.test(user_id)) {
    return NextResponse.json(
      { error: "user_id の形式が不正です。" },
      { status: 400 }
    );
  }
  if (!DATE_RE.test(grant_date) || !DATE_RE.test(expiry_date)) {
    return NextResponse.json(
      { error: "日付は YYYY-MM-DD 形式で指定してください。" },
      { status: 400 }
    );
  }
  // 付与日数は 0.5〜40 の範囲（労基法の上限を考慮）
  if (
    typeof granted_days !== "number" ||
    granted_days <= 0 ||
    granted_days > 40
  ) {
    return NextResponse.json(
      { error: "granted_days は 0より大きく40以下の数値で指定してください。" },
      { status: 400 }
    );
  }

  // DBに有給付与を登録
  const { data, error } = await supabase
    .from("paid_leave_grants")
    .insert({ user_id, grant_date, granted_days, expiry_date, note: note ?? null })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "有給付与の登録に失敗しました。" },
      { status: 500 }
    );
  }

  // 201 Created = 「新しいデータを作成しました」を表すHTTPステータスコード
  return NextResponse.json(data, { status: 201 });
}

/**
 * DELETE /api/paid-leave?id=uuid
 * 管理者のみ: 有給付与記録を削除
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "削除対象の id は必須です。" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("paid_leave_grants")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: "有給付与の削除に失敗しました。" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
