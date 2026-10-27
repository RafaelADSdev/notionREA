import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { databaseFailure, databaseHeaders } from "@/features/databases/server/http";
import { loadDatabaseRecord } from "@/features/databases/server/queries";
import { currentUser } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ databaseId: string; pageId: string }> },
) {
  if (!(await currentUser()))
    return NextResponse.json({ error: "Entre novamente." }, { status: 401, headers: databaseHeaders });
  try {
    const { databaseId, pageId } = z
      .strictObject({ databaseId: z.uuid(), pageId: z.uuid() })
      .parse(await params);
    return NextResponse.json(await loadDatabaseRecord(databaseId, pageId), { headers: databaseHeaders });
  } catch (error) {
    return databaseFailure(error);
  }
}
