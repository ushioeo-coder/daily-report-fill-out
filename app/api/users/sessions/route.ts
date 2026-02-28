import { NextRequest, NextResponse } from "next/server";
import { getSession, deleteUserSessions } from "@/lib/session";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/users/sessions?id=uuid
 * admin のみ: 指定ユーザーの全セッションを削除 (強制ログアウト)
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
      { error: "対象ユーザーの id は必須です。" },
      { status: 400 }
    );
  }

  if (!UUID_RE.test(userId)) {
    return NextResponse.json(
      { error: "id の形式が不正です。" },
      { status: 400 }
    );
  }

  await deleteUserSessions(userId);
  return NextResponse.json({ ok: true });
}
