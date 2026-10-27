import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand, Icon } from "@/components/icon";
import { uuidSchema } from "@/features/auth/validation";
import { getTranslations } from "@/lib/i18n/server";
import { createClient, currentUser } from "@/lib/supabase/server";

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string }>;
}) {
  const t = await getTranslations();

  if (!(await currentUser())) redirect("/login");
  const client = await createClient();
  const after = (await searchParams).after;
  let query = client.from("workspaces").select("id,name").order("id").limit(51);
  if (after && uuidSchema.safeParse(after).success) query = query.gt("id", after);
  const { data, error } = await query;
  if (error) throw new Error(t("workspaces.loadFailed"));
  const visible = data.slice(0, 50);
  return (
    <main id="main" className="workspace-main">
      <Link href="/" aria-label={t("navigation.brandStart")}>
        <Brand />
      </Link>
      <div className="document-heading" style={{ marginTop: 52 }}>
        <h1>{t("workspaces.yourWorkspaces")}</h1>
        <p>{t("workspaces.choose")}</p>
      </div>
      <nav className="nav-list" aria-label={t("workspaces.list")}>
        {visible.map((item) => (
          <Link key={item.id} href={`/w/${item.id}`} className="nav-link">
            <Icon name="layers" />
            {item.name}
            <Icon name="arrow" />
          </Link>
        ))}
      </nav>
      {!visible.length && <p className="notice">{t("workspaces.none")}</p>}
      <div className="form-links">
        <Link className="button" href="/workspaces/new">
          {t("workspaces.create")}
        </Link>
        {data.length > 50 && (
          <Link href={`/workspaces?after=${visible.at(-1)?.id}`}>{t("workspaces.next")}</Link>
        )}
      </div>
    </main>
  );
}
