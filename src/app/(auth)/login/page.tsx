import { redirect } from "next/navigation";
import { AuthForm } from "@/features/auth/auth-form";
import { isLocalPreviewEnabled } from "@/features/auth/local-preview-policy";
import { safeRedirect } from "@/features/auth/validation";
import { getEnvironment } from "@/lib/env";
import { getTranslations } from "@/lib/i18n/server";
import { currentUser } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("auth.signIn") };
}
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; status?: string }>;
}) {
  const t = await getTranslations();

  if (await currentUser()) redirect("/");
  if (isLocalPreviewEnabled(getEnvironment())) redirect("/auth/local");
  const query = await searchParams;
  return (
    <>
      <h1>{t("auth.welcomeBack")}</h1>
      <p>{t("auth.continueWhereLeft")}</p>
      {query.status === "callback-error" && (
        <p role="alert" className="form-feedback error">
          {t("auth.callbackFailed")}
        </p>
      )}
      <AuthForm
        mode="login"
        next={safeRedirect(query.next ?? null)}
        googleEnabled={getEnvironment().GOOGLE_AUTH_ENABLED === "true"}
      />
    </>
  );
}
