import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { uuidSchema } from "@/features/auth/validation";
import { InvitationForm, MemberForm } from "@/features/workspaces/forms";
import { getTranslations } from "@/lib/i18n/server";
import { createClient, currentUser } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("navigation.team") };
}
export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ afterTime?: string; afterId?: string }>;
}) {
  const t = await getTranslations();

  const user = await currentUser();
  if (!user) redirect("/login");
  const { workspaceId } = await params;
  const client = await createClient();
  const { data: membership } = await client
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) notFound();
  if (membership.role !== "owner")
    return (
      <div className="document-heading">
        <h1>{t("workspaces.teamHeading")}</h1>
        <p>{t("workspaces.memberNotice")}</p>
      </div>
    );
  const cursor = await searchParams;
  const afterTime = z.iso.datetime({ offset: true }).safeParse(cursor.afterTime);
  const afterId = uuidSchema.safeParse(cursor.afterId);
  const paged = afterTime.success && afterId.success;
  const { data: members, error } = await client.rpc("list_workspace_members", {
    p_workspace_id: workspaceId,
    ...(paged ? { p_after_created_at: afterTime.data, p_after_user_id: afterId.data } : {}),
  });
  if (error) throw new Error(t("workspaces.teamFailed"));
  const visible = members.slice(0, 50);
  const last = visible.at(-1);
  return (
    <>
      <div className="document-heading">
        <h1>{t("workspaces.teamWelcome")}</h1>
        <p>{t("workspaces.teamDescription")}</p>
      </div>
      <section className="section">
        <h2>{t("workspaces.invitePerson")}</h2>
        <InvitationForm workspaceId={workspaceId} />
        <p className="notice">{t("workspaces.inviteNotice")}</p>
      </section>
      <section className="section">
        <h2>{t("workspaces.members")}</h2>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{t("workspaces.peopleAndPermissions")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("common.person")}</th>
                <th scope="col">{t("common.access")}</th>
                <th scope="col">{t("common.manage")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((member) => (
                <tr key={member.user_id}>
                  <td>
                    {member.email}
                    {member.user_id === user.id && <span className="notice"> {t("common.you")}</span>}
                  </td>
                  <td>
                    <span className="pill">
                      {member.role === "owner" ? t("common.administrator") : t("common.member")}
                    </span>
                  </td>
                  <td>
                    <MemberForm
                      workspaceId={workspaceId}
                      userId={member.user_id}
                      email={member.email}
                      role={member.role}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <nav className="form-links" aria-label={t("workspaces.teamPages")}>
          {paged && <Link href={`/w/${workspaceId}/members`}>{t("workspaces.firstMembers")}</Link>}
          {members.length > 50 && last && (
            <Link
              href={`/w/${workspaceId}/members?${new URLSearchParams({ afterTime: last.created_at, afterId: last.user_id })}`}
            >
              {t("workspaces.nextMembers")}
            </Link>
          )}
        </nav>
        <p className="notice">{t("workspaces.keepOwner")}</p>
      </section>
    </>
  );
}
