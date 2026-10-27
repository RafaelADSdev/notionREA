import { AuthForm } from "@/features/auth/auth-form";
import { getTranslations } from "@/lib/i18n/server";
export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("auth.newPassword") };
}
export default async function ResetPasswordPage() {
  const t = await getTranslations();

  return (
    <>
      <h1>{t("auth.resetHeading")}</h1>
      <p>{t("auth.resetDescription")}</p>
      <AuthForm mode="reset" />
    </>
  );
}
