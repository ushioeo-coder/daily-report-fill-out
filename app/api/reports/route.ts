import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { computeDerivedColumns, RawReport } from "@/lib/calc";
import { EDIT_WINDOW_DAYS } from "@/lib/constants";

const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD[&user_id=uuid]
 *
 * user: 自分の日報のみ取得 (user_id パラメータは無視)
 * admin: user_id 指定で特定ユーザー、省略で全ユーザーの日報を取得
 *        レスポンスに計算列 (actual_work_minutes, overtime_minutes) を付与
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json(
      { error: "from と to パラメータは必須です。" },
      { status: 400 }
    );
  }

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "from / to は YYYY-MM-DD 形式で指定してください。" },
      { status: 400 }
    );
  }

  let query = supabase
    .from("daily_reports")
    .select("id, user_id, report_date, start_time, end_time, note, created_at, updated_at")
    .gte("report_date", from)
    .lte("report_date", to)
    .order("report_date", { ascending: true });

  if (session.role === "admin") {
    const userId = searchParams.get("user_id");
    if (userId) {
      if (!UUID_RE.test(userId)) {
        return NextResponse.json(
          { error: "user_id の形式が不正です。" },
          { status: 400 }
        );
      }
      query = query.eq("user_id", userId);
    }
  } else {
    // user は自分の日報のみ
    query = query.eq("user_id", session.id);
  }

  const { data: reports, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "日報の取得に失敗しました。" },
      { status: 500 }
    );
  }

  // admin には計算列を付与
  if (session.role === "admin") {
    const enriched = reports.map((r: RawReport & Record<string, unknown>) => ({
      ...r,
      ...computeDerivedColumns(r),
    }));
    return NextResponse.json(enriched);
  }

  return NextResponse.json(reports);
}

/**
 * POST /api/reports
 * body: { report_date, start_time?, end_time?, note?, user_id? }
 *
 * 日報を新規作成 (upsert: 同一日付が既にあれば更新)
 * admin は user_id を指定して他ユーザーの日報を保存可能
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.report_date !== "string") {
    return NextResponse.json(
      { error: "report_date は必須です。" },
      { status: 400 }
    );
  }

  const { report_date, start_time, end_time, note } = body;

  if (!DATE_RE.test(report_date)) {
    return NextResponse.json(
      { error: "report_date は YYYY-MM-DD 形式で指定してください。" },
      { status: 400 }
    );
  }

  // admin は user_id 指定可、user は自分のみ
  let targetUserId = session.id;
  if (body.user_id && session.role === "admin") {
    if (!UUID_RE.test(body.user_id)) {
      return NextResponse.json(
        { error: "user_id の形式が不正です。" },
        { status: 400 }
      );
    }
    targetUserId = body.user_id;
  }

  // 30日編集制限チェック (admin はスキップ)
  if (session.role !== "admin") {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - EDIT_WINDOW_DAYS);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    if (report_date < cutoffStr) {
      return NextResponse.json(
        { error: "編集期限を過ぎています。" },
        { status: 403 }
      );
    }
  }

  // start_time / end_time のバリデーション
  if (start_time != null && (typeof start_time !== "number" || !Number.isInteger(start_time) || start_time < 0 || start_time > 1439)) {
    return NextResponse.json(
      { error: "start_time は 0〜1439 の整数で指定してください。" },
      { status: 400 }
    );
  }
  if (end_time != null && (typeof end_time !== "number" || !Number.isInteger(end_time) || end_time < 0 || end_time > 1439)) {
    return NextResponse.json(
      { error: "end_time は 0〜1439 の整数で指定してください。" },
      { status: 400 }
    );
  }
  if (start_time != null && end_time != null && start_time >= end_time) {
    return NextResponse.json(
      { error: "end_time は start_time より後の時刻を指定してください。" },
      { status: 400 }
    );
  }

  // note のバリデーション
  if (note != null && (typeof note !== "string" || note.length > 1000)) {
    return NextResponse.json(
      { error: "note は 1000 文字以内で入力してください。" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("daily_reports")
    .upsert(
      {
        user_id: targetUserId,
        report_date,
        start_time: start_time ?? null,
        end_time: end_time ?? null,
        note: note ?? null,
      },
      { onConflict: "user_id,report_date" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "日報の保存に失敗しました。" },
      { status: 500 }
    );
  }

  return NextResponse.json(data, { status: 201 });
}
