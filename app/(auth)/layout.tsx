import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  // ログイン済みの場合はロールに応じたページへリダイレクト
  if (session) {
    if (session.role === "admin") {
      redirect("/admin/reports");
    } else {
      redirect("/reports");
    }
  }

  return <>{children}</>;
}
