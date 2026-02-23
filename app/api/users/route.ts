import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcrypt";
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

/**
 * POST /api/users
 * admin のみ: ユーザー新規作成
 * body: { employee_id, name, password, role? }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const { employee_id, name, password, role } = body ?? {};

  if (
    typeof employee_id !== "string" ||
    typeof name !== "string" ||
    typeof password !== "string" ||
    employee_id.trim() === "" ||
    name.trim() === "" ||
    password.trim() === ""
  ) {
    return NextResponse.json(
      { error: "社員番号・氏名・パスワードは必須です。" },
      { status: 400 }
    );
  }

  if (!/^\d{4}$/.test(employee_id.trim())) {
    return NextResponse.json(
      { error: "社員番号は4桁の数字で入力してください。" },
      { status: 400 }
    );
  }

  const userRole = role === "admin" ? "admin" : "user";
  const passwordHash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from("users")
    .insert({
      employee_id: employee_id.trim(),
      name: name.trim(),
      password_hash: passwordHash,
      role: userRole,
    })
    .select("id, employee_id, name, role")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "この社員番号は既に登録されています。" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "ユーザーの作成に失敗しました。" },
      { status: 500 }
    );
  }

  return NextResponse.json(data, { status: 201 });
}

/**
 * DELETE /api/users?id=uuid
 * admin のみ: ユーザー削除 (CASCADE で日報・セッションも削除)
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const userId = req.nextUrl.searchParams.get("id");
  if (!userId) {
    return NextResponse.json(
      { error: "削除対象の id は必須です。" },
      { status: 400 }
    );
  }

  // 自分自身の削除を防止
  if (userId === session.id) {
    return NextResponse.json(
      { error: "自分自身は削除できません。" },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("users").delete().eq("id", userId);

  if (error) {
    return NextResponse.json(
      { error: "ユーザーの削除に失敗しました。" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
