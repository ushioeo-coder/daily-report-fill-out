import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

// 日付形式チェック用の正規表現（例: "2026-03-21"）
const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/**
 * GET /api/admin/holidays?year=2026&month=3
 * 管理者のみ: 指定年月の法定休日一覧を返す
 */
export async function GET(req: NextRequest) {
  // セッション確認（ログイン済みであれば一般ユーザーも読み取り可）
  // ※ 法定休日の読み取りは日報表示に必要なため、全ユーザーに開放する
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const year = req.nextUrl.searchParams.get("year");
  const month = req.nextUrl.searchParams.get("month");

  if (!year || !month) {
    return NextResponse.json(
      { error: "year と month は必須です。" },
      { status: 400 }
    );
  }

  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10);

  if (
    isNaN(yearNum) ||
    isNaN(monthNum) ||
    monthNum < 1 ||
    monthNum > 12
  ) {
    return NextResponse.json(
      { error: "year・month の値が不正です。" },
      { status: 400 }
    );
  }

  // 指定月の開始日・終了日を計算
  const paddedMonth = String(monthNum).padStart(2, "0");
  const startDate = `${yearNum}-${paddedMonth}-01`;
  // 翌月の1日から1日引くことで月末日を計算
  const endDate = new Date(yearNum, monthNum, 0)
    .toISOString()
    .slice(0, 10);

  // DBから指定月の法定休日を取得（日付昇順）
  const { data, error } = await supabase
    .from("company_holidays")
    .select("id, holiday_date")
    .gte("holiday_date", startDate)
    .lte("holiday_date", endDate)
    .order("holiday_date", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "法定休日の取得に失敗しました。" },
      { status: 500 }
    );
  }

  // holiday_date を "YYYY-MM-DD" 文字列に正規化して返す
  const holidayRows = Array.isArray(data)
    ? (data as { id: string; holiday_date: string | Date }[])
    : [];

  const normalized = holidayRows.map((row: { id: string; holiday_date: string | Date }) => ({
    id: row.id,
    holiday_date:
      typeof row.holiday_date === "string"
        ? row.holiday_date.slice(0, 10)
        : new Date(row.holiday_date).toISOString().slice(0, 10),
  }));

  return NextResponse.json(normalized);
}

/**
 * POST /api/admin/holidays
 * 管理者のみ: 法定休日を登録
 * body: { holiday_date: "2026-03-21" }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  // リクエストボディを解析
  const body = await req.json().catch(() => null);
  const { holiday_date } = body ?? {};

  // 必須項目・形式チェック
  if (!holiday_date || !DATE_RE.test(holiday_date)) {
    return NextResponse.json(
      { error: "holiday_date は YYYY-MM-DD 形式で指定してください。" },
      { status: 400 }
    );
  }

  // DBに法定休日を登録
  const { data, error } = await supabase
    .from("company_holidays")
    .insert({ holiday_date })
    .select("id, holiday_date")
    .single();

  if (error) {
    // 23505 = UNIQUE制約違反（同じ日を二重登録しようとした場合）
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "この日付は既に法定休日として登録されています。" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "法定休日の登録に失敗しました。" },
      { status: 500 }
    );
  }

  const insertedHoliday = data as { id: string; holiday_date: string | Date };

  // holiday_date を "YYYY-MM-DD" 形式に正規化（pgはDATE型をDateオブジェクトで返すため）
  const normalized = {
    id: insertedHoliday.id,
    holiday_date:
      typeof insertedHoliday.holiday_date === "string"
        ? insertedHoliday.holiday_date.slice(0, 10)
        : new Date(insertedHoliday.holiday_date).toISOString().slice(0, 10),
  };

  // 201 Created: 新しいデータを作成したことを示すHTTPステータスコード
  return NextResponse.json(normalized, { status: 201 });
}

/**
 * DELETE /api/admin/holidays?date=2026-03-21
 * 管理者のみ: 指定日の法定休日を削除
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const date = req.nextUrl.searchParams.get("date");

  // 日付の存在・形式チェック
  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json(
      { error: "date は YYYY-MM-DD 形式で指定してください。" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("company_holidays")
    .delete()
    .eq("holiday_date", date);

  if (error) {
    return NextResponse.json(
      { error: "法定休日の削除に失敗しました。" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
