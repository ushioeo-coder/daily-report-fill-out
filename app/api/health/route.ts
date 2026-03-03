import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    node: process.version,
    port: process.env.PORT ?? "(not set)",
    env: process.env.NODE_ENV ?? "(not set)",
    db: process.env.DATABASE_URL ? "configured" : "not configured",
  });
}
