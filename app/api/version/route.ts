import { NextResponse } from "next/server";

export async function GET() {
    return NextResponse.json({
        version: "v3",
        message: "Deploy successful. Conditional formatting logic and Sunday dynamic color are applied.",
        timestamp: new Date().toISOString()
    });
}
