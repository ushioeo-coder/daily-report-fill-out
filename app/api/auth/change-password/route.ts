import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => null);
        const { employee_id, old_password, new_password } = body ?? {};

        if (
            typeof employee_id !== "string" ||
            typeof old_password !== "string" ||
            typeof new_password !== "string" ||
            employee_id.trim() === "" ||
            old_password.trim() === "" ||
            new_password.trim() === ""
        ) {
            return NextResponse.json(
                { error: "必要な項目が入力されていません。" },
                { status: 400 }
            );
        }

        // 「英数6文字以上」のチェック
        if (!/^[A-Za-z0-9]{6,}$/.test(new_password)) {
            return NextResponse.json(
                { error: "新しいパスワードは半角英数字6文字以上で入力してください。" },
                { status: 400 }
            );
        }

        // 1. ユーザーの検索
        const { data: user, error: fetchError } = await supabase
            .from("users")
            .select("id, password_hash")
            .eq("employee_id", employee_id.trim())
            .single();

        if (fetchError || !user) {
            return NextResponse.json(
                { error: "社員番号または現在のパスワードが正しくありません。" },
                { status: 401 }
            );
        }

        const existingUser = user as { id: string; password_hash: string };

        // 2. 現在のパスワード確認
        const isValid = await bcrypt.compare(old_password, existingUser.password_hash).catch(() => false);
        if (!isValid) {
            return NextResponse.json(
                { error: "社員番号または現在のパスワードが正しくありません。" },
                { status: 401 }
            );
        }

        // 3. 新しいパスワードのハッシュ化と保存
        const newPasswordHash = await bcrypt.hash(new_password, 10);
        const { error: updateError } = await supabase
            .from("users")
            .update({ password_hash: newPasswordHash })
            .eq("id", existingUser.id);

        if (updateError) {
            console.error("Change password error:", updateError);
            return NextResponse.json(
                { error: "パスワードの更新に失敗しました。" },
                { status: 500 }
            );
        }

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error("Unhandled error in change-password:", err);
        return NextResponse.json(
            { error: "予期せぬエラーが発生しました。" },
            { status: 500 }
        );
    }
}
