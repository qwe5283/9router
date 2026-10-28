import { NextResponse } from "next/server";
import { getDashboardLoginEvents } from "@/lib/db/repos/dashboardLoginEventsRepo";

export const dynamic = "force-dynamic";

// Covered by the same dashboard access guard as /api/settings.
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    return NextResponse.json({ events: await getDashboardLoginEvents() }, { headers });
  } catch {
    return NextResponse.json({ error: "Failed to load login history" }, { status: 500, headers });
  }
}
