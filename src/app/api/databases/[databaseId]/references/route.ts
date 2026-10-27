import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { databaseFailure, databaseHeaders } from "@/features/databases/server/http";
import { findDatabaseReferences } from "@/features/databases/server/queries";
import { currentUser } from "@/lib/supabase/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ databaseId: string }> }) {
  if (!(await currentUser()))
    return NextResponse.json({ error: "Entre novamente." }, { status: 401, headers: databaseHeaders });
  try {
    const id = z.uuid().parse((await params).databaseId);
    const query = z
      .strictObject({ query: z.string().max(500).optional(), cursor: z.string().max(512).optional() })
      .parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await findDatabaseReferences(id, query), { headers: databaseHeaders });
  } catch (error) {
    return databaseFailure(error);
  }
}
