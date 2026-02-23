import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { LogoutButton } from "./logout-button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold text-gray-800">日報管理</h1>
            <span className="text-sm text-gray-600">
              {session.name}({session.employee_id})
            </span>
            {session.role === "admin" && (
              <nav className="flex gap-3 text-sm">
                <Link
                  href="/admin/reports"
                  className="text-blue-600 hover:underline"
                >
                  日報一覧
                </Link>
                <Link
                  href="/admin/export"
                  className="text-blue-600 hover:underline"
                >
                  Excel出力
                </Link>
              </nav>
            )}
          </div>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
