import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/icon";
import { WorkspaceForm } from "@/features/workspaces/forms";
import { getTranslations } from "@/lib/i18n/server";
import { currentUser } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("workspaces.create") };
}
export default async function NewWorkspacePage() {
  const t = await getTranslations();

  if (!(await currentUser())) redirect("/login");
  return (
    <main id="main" className="auth-main" style={{ minHeight: "100svh" }}>
      <div className="auth-content">
        <Link href="/" aria-label={t("navigation.brandStart")}>
          <Brand />
        </Link>
        <h1>{t("workspaces.newHeading")}</h1>
        <p>{t("workspaces.newDescription")}</p>
        <WorkspaceForm requestId={randomUUID()} />
        <p className="form-footer">
          <Link href="/workspaces">{t("workspaces.viewMine")}</Link>
        </p>
      </div>
    </main>
  );
}
