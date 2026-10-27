import { AuthForm } from "@/features/auth/auth-form";
import { getTranslations } from "@/lib/i18n/server";
export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("auth.createAccount") };
}
export default async function RegisterPage() {
  const t = await getTranslations();

  return (
    <>
      <h1>{t("auth.registerHeading")}</h1>
      <p>{t("auth.registerDescription")}</p>
      <AuthForm mode="register" />
    </>
  );
}
