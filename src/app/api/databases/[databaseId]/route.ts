import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { commandDatabase } from "@/features/databases/server/commands";
import { databaseFailure, databaseHeaders, sameDatabaseOrigin } from "@/features/databases/server/http";
import { loadDatabase } from "@/features/databases/server/queries";
import { queryActionSchema } from "@/features/databases/server/validation";
import { readBoundedJson } from "@/lib/http";
import { getTranslations } from "@/lib/i18n/server";
import { currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;
type Context = { params: Promise<{ databaseId: string }> };
export async function GET(request: NextRequest, context: Context) {
  const t = await getTranslations();

  if (!(await currentUser()))
    return NextResponse.json({ error: t("errors.signInAgain") }, { status: 401, headers: databaseHeaders });
  try {
    const id = z.uuid().parse((await context.params).databaseId);
    const query = z
      .strictObject({
        viewId: z.uuid().optional(),
        month: z
          .string()
          .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/)
          .optional(),
      })
      .parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await loadDatabase(id, query), { headers: databaseHeaders });
  } catch (error) {
    return databaseFailure(error);
  }
}
export async function POST(request: NextRequest, context: Context) {
  const t = await getTranslations();

  if (!sameDatabaseOrigin(request))
    return NextResponse.json({ error: t("errors.invalidOrigin") }, { status: 403, headers: databaseHeaders });
  const actor = await currentUser();
  if (!actor)
    return NextResponse.json({ error: t("errors.signInAgain") }, { status: 401, headers: databaseHeaders });
  try {
    const id = z.uuid().parse((await context.params).databaseId);
    const body = await readBoundedJson(request, 262144);
    if (body !== null && typeof body === "object" && "action" in body && body.action === "query") {
      const parsed = queryActionSchema.parse(body);
      const query = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "action"));
      return NextResponse.json(await loadDatabase(id, query), { headers: databaseHeaders });
    }
    const operation = request.headers.get("x-operation-id");
    const result = await commandDatabase(
      id,
      body,
      actor.id,
      operation ? z.uuid().parse(operation) : undefined,
    );
    return NextResponse.json(result, { headers: databaseHeaders });
  } catch (error) {
    return databaseFailure(error);
  }
}
