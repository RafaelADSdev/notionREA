import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicationToken, publicChunkSchema } from "@/features/sharing/model";
import { getTranslations } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const querySchema = z.strictObject({
  hash: publicationToken,
  index: z.coerce.number().int().min(0).max(191),
});

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const t = await getTranslations();
  const token = publicationToken.safeParse((await context.params).token);
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!token.success || !query.success)
    return NextResponse.json({ error: t("sharing.temporary") }, { status: 400, headers });
  const client = await createClient();
  const result = await client.rpc("read_public_content_chunk", {
    p_token: token.data,
    p_hash: query.data.hash,
    p_index: query.data.index,
  });
  if (result.error || !result.data) {
    const status = result.error?.code === "40001" ? 409 : result.error ? 503 : 404;
    return NextResponse.json(
      { error: t(status === 409 ? "sharing.contentChanged" : "sharing.temporary") },
      { status, headers },
    );
  }
  const chunk = publicChunkSchema.safeParse(result.data);
  if (!chunk.success) return NextResponse.json({ error: t("sharing.temporary") }, { status: 503, headers });
  return NextResponse.json(chunk.data, { headers });
}
