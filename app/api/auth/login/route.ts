import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { supabase } from "@/lib/supabase";
import { createSession, SESSION_COOKIE } from "@/lib/session";
import { SESSION_TTL_MS } from "@/lib/constants";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { employee_id, password } = body ?? {};

  if (
    typeof employee_id !== "string" ||
    typeof password !== "string" ||
    employee_id.trim() === "" ||
    password.trim() === ""
  ) {
    return NextResponse.json(
      { error: "社員番号とパスワードを入力してください。" },
      { status: 400 }
    );
  }

  // ユーザー検索
  const { data: user, error } = await supabase
    .from("users")
    .select("id, employee_id, name, role, password_hash")
    .eq("employee_id", employee_id.trim())
    .single();

  // DB 接続エラーの場合はサーバーエラーとして返す
  if (error && error.code !== "PGRST116") {
    console.error("Login DB error:", error);
    return NextResponse.json(
      { error: "サーバーエラーが発生しました。しばらく経ってからお試しください。" },
      { status: 500 }
    );
  }

  // ユーザー不存在 or パスワード不一致を区別せず同一メッセージで返す (ユーザー列挙防止)
  const bcryptResult = !error && user
    ? await bcrypt.compare(password, user.password_hash).catch(() => false)
    : false;
  const isValid = !error && user && bcryptResult;

  if (!isValid) {
    return NextResponse.json(
      { error: "社員番号またはパスワードが正しくありません。" },
      { status: 401 }
    );
  }

  const token = await createSession(user.id);

  const res = NextResponse.json({
    user: {
      id: user.id,
      employee_id: user.employee_id,
      name: user.name,
      role: user.role,
    },
  });

  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS / 1000, // 秒換算
    path: "/",
  });

  return res;
}
