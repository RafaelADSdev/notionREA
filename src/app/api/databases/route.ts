import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDatabase } from "@/features/databases/server/commands";
import { databaseFailure, databaseHeaders, sameDatabaseOrigin } from "@/features/databases/server/http";
import { listDatabases } from "@/features/databases/server/queries";
import { readBoundedJson } from "@/lib/http";
import { getTranslations } from "@/lib/i18n/server";
import { currentUser } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const t = await getTranslations();

  if (!(await currentUser()))
    return NextResponse.json({ error: t("errors.signInAgain") }, { status: 401, headers: databaseHeaders });
  try {
    const { workspaceId, ...query } = z
      .strictObject({
        workspaceId: z.uuid(),
        query: z.string().max(500).optional(),
        cursor: z.string().max(512).optional(),
      })
      .parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listDatabases(workspaceId, query), { headers: databaseHeaders });
  } catch (error) {
    return databaseFailure(error);
  }
}
export async function POST(request: NextRequest) {
  const t = await getTranslations();

  if (!sameDatabaseOrigin(request))
    return NextResponse.json({ error: t("errors.invalidOrigin") }, { status: 403, headers: databaseHeaders });
  if (!(await currentUser()))
    return NextResponse.json({ error: t("errors.signInAgain") }, { status: 401, headers: databaseHeaders });
  try {
    return NextResponse.json(await createDatabase(await readBoundedJson(request, 16384)), {
      headers: databaseHeaders,
    });
  } catch (error) {
    return databaseFailure(error);
  }
}
