import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEnvironment } from "@/lib/env";
import { safeRedirect } from "@/features/auth/validation";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code && code.length <= 2048) {
    const client = await createClient(true);
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(safeRedirect(request.nextUrl.searchParams.get("next")), getEnvironment().APP_URL),
      );
  }
  return NextResponse.redirect(new URL("/login?status=callback-error", getEnvironment().APP_URL));
}
