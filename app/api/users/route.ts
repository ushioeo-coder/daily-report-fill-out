import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/users
 * admin のみ: 全ユーザー一覧を返す
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, employee_id, name, role")
    .order("employee_id", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "ユーザー一覧の取得に失敗しました。" },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}
