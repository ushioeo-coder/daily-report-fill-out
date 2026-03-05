import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { getSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

/**
 * POST /api/auth/verify-admin
 * 管理者パスワード再確認 — admin ページアクセス時に使用
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.password || typeof body.password !== "string") {
    return NextResponse.json(
      { error: "パスワードは必須です。" },
      { status: 400 }
    );
  }

  const { data: user } = await supabase
    .from("users")
    .select("password_hash")
    .eq("id", session.id)
    .single();

  if (!user) {
    return NextResponse.json(
      { error: "ユーザーが見つかりません。" },
      { status: 404 }
    );
  }

  const valid = await bcrypt.compare(body.password, user.password_hash);
  if (!valid) {
    return NextResponse.json(
      { error: "パスワードが正しくありません。" },
      { status: 401 }
    );
  }

  return NextResponse.json({ ok: true });
}
