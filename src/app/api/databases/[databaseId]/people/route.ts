import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { databaseFailure, databaseHeaders } from "@/features/databases/server/http";
import { listDatabasePeople } from "@/features/databases/server/queries";
import { getTranslations } from "@/lib/i18n/server";
import { currentUser } from "@/lib/supabase/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ databaseId: string }> }) {
  const t = await getTranslations();

  if (!(await currentUser()))
    return NextResponse.json({ error: t("errors.signInAgain") }, { status: 401, headers: databaseHeaders });
  try {
    const id = z.uuid().parse((await params).databaseId);
    const query = z
      .strictObject({ cursor: z.string().max(512).optional() })
      .parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listDatabasePeople(id, query), { headers: databaseHeaders });
  } catch (error) {
    return databaseFailure(error);
  }
}
