import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";

/** 認証不要のパス */
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 公開パスはスルー
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;

  // トークンなし → ログインページへ
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // トークンの検証は各 Route Handler / Page の getSession() に委ねる。
  // middleware では cookie の存在チェックのみ行い、DB アクセスを省く。
  // (Edge Runtime では DB 直接アクセスが難しいため)
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 以下を除くすべてのパスにミドルウェアを適用:
     * - _next/static (静的ファイル)
     * - _next/image (画像最適化)
     * - favicon.ico
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
