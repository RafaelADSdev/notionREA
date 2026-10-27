import { NextResponse } from "next/server";
import { getEnvironment } from "@/lib/env";
import { getTranslations } from "@/lib/i18n/server";
import { createClient, currentUser } from "@/lib/supabase/server";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};
export async function POST(request: Request) {
  const t = await getTranslations();

  if (request.headers.get("origin") !== new URL(getEnvironment().APP_URL).origin)
    return NextResponse.json({ error: t("errors.invalidOrigin") }, { status: 403, headers });
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: t("errors.signInAgain") }, { status: 401, headers });
  const client = await createClient();
  const { data, error } = await client.auth.getSession();
  const session = data.session;
  if (error || !session || !session.expires_at || session.expires_at <= Date.now() / 1000)
    return NextResponse.json({ error: t("errors.signInAgain") }, { status: 401, headers });
  const verified = await client.auth.getClaims(session.access_token);
  if (verified.error || verified.data?.claims.sub !== actor.id)
    return NextResponse.json({ error: t("errors.signInAgain") }, { status: 401, headers });
  // Only this user's short-lived access token enters socket memory. Refresh tokens remain HttpOnly.
  return NextResponse.json({ accessToken: session.access_token, expiresAt: session.expires_at }, { headers });
}
