import Link from "next/link";
import { Brand } from "@/components/icon";
import { Join } from "@/features/workspaces/join";
import { getTranslations } from "@/lib/i18n/server";
import { currentUser } from "@/lib/supabase/server";

export default async function JoinPage() {
  const t = await getTranslations();

  const user = await currentUser();
  return (
    <main id="main" className="auth-main" style={{ minHeight: "100svh" }}>
      <div className="auth-content">
        <Brand />
        <h1>{t("workspaces.inviteWelcome")}</h1>
        {user ? (
          <>
            <p>
              {t("workspaces.confirmJoin")} {user.email}.
            </p>
            <Join />
          </>
        ) : (
          <>
            <p>{t("workspaces.signInToJoin")}</p>
            <Link className="button" href="/login">
              {t("auth.signInBloco")}
            </Link>
            <p className="form-footer">
              <Link href="/register">{t("auth.noAccount")}</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
