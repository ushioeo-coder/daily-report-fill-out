import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/debug/reset-password
 * 一時的なパスワードリセット用エンドポイント（開発用・本番前に削除すること）
 */
export async function GET() {
  const password = "password123";
  const hash = await bcrypt.hash(password, 10);

  const { data: d1, error: e1 } = await supabase
    .from("users")
    .update({ password_hash: hash })
    .eq("employee_id", "0001")
    .select("employee_id, name, role");

  const { data: d2, error: e2 } = await supabase
    .from("users")
    .update({ password_hash: hash })
    .eq("employee_id", "0002")
    .select("employee_id, name, role");

  return NextResponse.json({
    message: "Password reset complete",
    user_0001: e1 ? { error: e1.message } : d1,
    user_0002: e2 ? { error: e2.message } : d2,
  });
}
