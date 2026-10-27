import { type NextRequest, NextResponse } from "next/server";
import { isLocalPreviewEnabled } from "@/features/auth/local-preview-policy";
import { getEnvironment } from "@/lib/env";
import { getTranslations } from "@/lib/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const t = await getTranslations();

  const environment = getEnvironment();
  const origin = new URL(environment.APP_URL).origin;
  if (
    !isLocalPreviewEnabled(environment) ||
    request.nextUrl.protocol !== new URL(origin).protocol ||
    request.headers.get("host") !== new URL(origin).host ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return new NextResponse(null, { status: 404 });
  }
  const client = await createClient(true);
  const { data: session } = await client.auth.getUser();
  if (session.user) return NextResponse.redirect(new URL("/", origin));

  const admin = createAdminClient();
  const email = "local-preview@bloco.invalid";
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { local_preview: true },
  });
  if (created.error && created.error.code !== "email_exists") {
    throw new Error(t("auth.localStartFailed"));
  }
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.user || data.user.app_metadata.local_preview !== true) {
    throw new Error(t("auth.localLoginFailed"));
  }
  const verified = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verified.error) throw new Error(t("auth.localOpenFailed"));
  const workspace = await client.rpc("create_workspace", {
    p_name: "Prévia local",
    p_request_id: "77fbaee3-d376-4f86-8f84-53de82bd201b",
  });
  if (workspace.error || !workspace.data) throw new Error(t("auth.localWorkspaceFailed"));
  const response = NextResponse.redirect(new URL(`/w/${workspace.data}`, origin));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
