import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { getSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { UUID_RE, PASSWORD_RE } from "@/lib/validation";

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
    .select("id, employee_id, name, role, department, hire_date")
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
  const { employee_id, name, password, role, department, hire_date } = body ?? {};

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

  // パスワード条件チェック
  if (!PASSWORD_RE.test(password)) {
    return NextResponse.json(
      { error: "パスワードは半角英数字6文字以上で入力してください。" },
      { status: 400 }
    );
  }

  const userRole = role === "admin" ? "admin" : "user";
  const passwordHash = await bcrypt.hash(password, 10);

  const insertData: {
    employee_id: string;
    name: string;
    password_hash: string;
    role: string;
    department?: string;
    hire_date?: string;
  } = {
    employee_id: employee_id.trim(),
    name: name.trim(),
    password_hash: passwordHash,
    role: userRole,
  };
  if (typeof department === "string") insertData.department = department.trim();
  if (typeof hire_date === "string" && hire_date) insertData.hire_date = hire_date;

  const { data, error } = await supabase
    .from("users")
    .insert(insertData)
    .select("id, employee_id, name, role, department, hire_date")
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

  const createdUser = data as {
    id: string;
    employee_id: string;
    name: string;
    role: string;
  };

  return NextResponse.json(createdUser, { status: 201 });
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

  if (!UUID_RE.test(userId)) {
    return NextResponse.json(
      { error: "id の形式が不正です。" },
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

/**
 * PATCH /api/users
 * admin のみ: ユーザーのパスワード強制リセット
 * body: { user_id, new_password }
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const { user_id, new_password, department, hire_date } = body ?? {};

  if (!user_id || typeof user_id !== "string" || !UUID_RE.test(user_id)) {
    return NextResponse.json(
      { error: "ユーザーIDの形式が不正です。" },
      { status: 400 }
    );
  }

  // パスワード変更の場合
  if (new_password !== undefined) {
    if (typeof new_password !== "string" || new_password.trim() === "") {
      return NextResponse.json(
        { error: "新しいパスワードを入力してください。" },
        { status: 400 }
      );
    }

    // 自分自身のパスワードリセットを防止 (ログイン画面から自分で変えてもらう)
    if (user_id === session.id) {
      return NextResponse.json(
        { error: "自身のアカウントのパスワードはログイン画面から変更してください。" },
        { status: 400 }
      );
    }

    // パスワード条件チェック
    if (!PASSWORD_RE.test(new_password)) {
      return NextResponse.json(
        { error: "パスワードは半角英数字6文字以上で入力してください。" },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(new_password, 10);

    const { error } = await supabase
      .from("users")
      .update({ password_hash: passwordHash })
      .eq("id", user_id);

    if (error) {
      console.error("Admin Password Reset Error:", error);
      return NextResponse.json(
        { error: "パスワードの変更に失敗しました。" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  }

  // ユーザー情報（部署・入社日）更新の場合
  const updateData: { department?: string; hire_date?: string | null } = {};
  if (typeof department === "string") updateData.department = department.trim();
  if (hire_date !== undefined) updateData.hire_date = hire_date || null;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "更新するフィールドがありません。" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("users")
    .update(updateData)
    .eq("id", user_id);

  if (error) {
    console.error("User Update Error:", error);
    return NextResponse.json(
      { error: "ユーザー情報の更新に失敗しました。" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
