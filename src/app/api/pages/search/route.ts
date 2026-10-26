import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/supabase/server";
import { getEnvironment } from "@/lib/env";
import { uuidSchema } from "@/features/auth/validation";
import { searchPages } from "@/features/pages/queries";
import { PayloadLimitError, readBoundedJson } from "@/lib/http";

const input = z.object({
  workspaceId: uuidSchema,
  query: z.string().max(200),
  cursor: z
    .object({
      id: uuidSchema.optional(),
      rank: z.number().finite().optional(),
      updatedAt: z.iso.datetime({ offset: true }).optional(),
    })
    .optional(),
});
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(getEnvironment().APP_URL).origin)
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  if (!(await currentUser())) return NextResponse.json({ error: "Entre novamente." }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 2048)
    return NextResponse.json({ error: "Consulta extensa." }, { status: 413 });
  let parsed: z.infer<typeof input>;
  try {
    parsed = input.parse(await readBoundedJson(request, 2048));
  } catch (error) {
    return NextResponse.json(
      { error: "Consulta inválida." },
      { status: error instanceof PayloadLimitError ? 413 : 400 },
    );
  }
  try {
    return NextResponse.json(await searchPages(parsed.workspaceId, parsed.query, parsed.cursor), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível buscar as páginas." }, { status: 403 });
  }
}
