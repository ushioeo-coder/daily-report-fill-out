import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/session";

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session || session.role !== "admin") {
            return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
        }

        const body = await req.json().catch(() => null);
        const { startDate, endDate } = body ?? {};

        if (!startDate || !endDate) {
            return NextResponse.json({ error: "削除期間を指定してください。" }, { status: 400 });
        }

        const { error } = await supabase
            .from("reports")
            .delete()
            .gte("report_date", startDate)
            .lte("report_date", endDate);

        if (error) {
            console.error("Bulk delete error:", error);
            return NextResponse.json({ error: error.message || JSON.stringify(error) || "データの削除に失敗しました。" }, { status: 500 });
        }

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error("Unhandled error in bulk-delete:", err);
        return NextResponse.json({ error: "予期せぬエラーが発生しました。" }, { status: 500 });
    }
}
