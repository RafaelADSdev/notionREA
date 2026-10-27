import { AuthForm } from "@/features/auth/auth-form";
import { getTranslations } from "@/lib/i18n/server";
export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("auth.recoverAccess") };
}
export default async function ForgotPasswordPage() {
  const t = await getTranslations();

  return (
    <>
      <h1>{t("auth.recoverHeading")}</h1>
      <p>{t("auth.recoverDescription")}</p>
      <AuthForm mode="forgot" />
    </>
  );
}
