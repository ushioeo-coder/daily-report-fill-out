import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { AdminAuthGate } from "./admin-auth-gate";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    redirect("/reports");
  }

  return <AdminAuthGate>{children}</AdminAuthGate>;
}
