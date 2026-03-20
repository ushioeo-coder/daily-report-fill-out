import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

/**
 * ルートページ: ログイン状態とロールに応じて適切なページへリダイレクトする。
 * - 未ログイン → /login
 * - admin     → /admin/reports（ユーザー選択付き日報一覧）
 * - 一般ユーザー → /reports（自分の日報）
 */
export default async function Home() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (session.role === "admin") {
    redirect("/admin/reports");
  }

  redirect("/reports");
}
