import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

// UUID形式チェック用の正規表現（レジェックス）
// 例: "550e8400-e29b-41d4-a716-446655440000" のような形式
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const usedDays = usedReports?.length ?? 0;
  const today = new Date().toISOString().split("T")[0];

  // 有効期限内の付与合計のみを残日数計算に使用
  type GrantRow = { expiry_date: string; granted_days: number | string };
  const validGrants = (grants ?? []).filter(
    (g: GrantRow) => g.expiry_date >= today
  );
  const totalGranted = validGrants.reduce(
    (sum: number, g: GrantRow) => sum + Number(g.granted_days),
    0
  );
  // 残日数は 0 を下回らないよう保証
  const remainingDays = Math.max(totalGranted - usedDays, 0);

  return NextResponse.json({
    grants: grants ?? [],
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
