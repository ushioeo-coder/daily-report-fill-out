import "server-only";
import { cookies } from "next/headers";
import { supabase } from "@/lib/supabase";
import { SESSION_TTL_MS } from "@/lib/constants";
import crypto from "crypto";

export const SESSION_COOKIE = "session_token";

export type SessionUser = {
  id: string;
  employee_id: string;
  name: string;
  role: "user" | "admin";
};

/** ランダムなセッショントークン (hex 64文字) を生成 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** DB にセッションを作成し、トークンを返す */
export async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  const { error } = await supabase.from("sessions").insert({
    user_id: userId,
    token,
    expires_at: expiresAt,
  });

  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return token;
}

/**
 * cookie からセッションを検証し、有効なら SessionUser を返す。
 * 同時に expires_at を現在時刻 + 7日 に延長する (スライディングセッション)。
 * 無効 / 期限切れの場合は null を返す。
 */
export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const now = new Date().toISOString();

  const { data: session, error } = await supabase
    .from("sessions")
    .select("user_id, expires_at, users(id, employee_id, name, role)")
    .eq("token", token)
    .gt("expires_at", now)
    .single();

  if (error || !session) return null;

  // expires_at を延長 (スライディングセッション)
  const newExpiry = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await supabase
    .from("sessions")
    .update({ expires_at: newExpiry })
    .eq("token", token);

  const user = session.users as unknown as SessionUser;
  return {
    id: user.id,
    employee_id: user.employee_id,
    name: user.name,
    role: user.role,
  };
}

/** セッションを削除 (ログアウト) */
export async function deleteSession(token: string): Promise<void> {
  await supabase.from("sessions").delete().eq("token", token);
}

/** 期限切れセッションを一括削除 (定期メンテナンス用) */
export async function purgeExpiredSessions(): Promise<void> {
  await supabase
    .from("sessions")
    .delete()
    .lt("expires_at", new Date().toISOString());
}
