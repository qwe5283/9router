import { NextResponse } from "next/server";
import { getProviderIconOptions } from "@/lib/providerIcons";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ icons: getProviderIconOptions() });
  } catch (error) {
    console.error("Error listing provider avatars:", error);
    return NextResponse.json({ error: "Unable to load provider avatars" }, { status: 500 });
  }
}
