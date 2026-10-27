import type { NextRequest } from "next/server";
import { interchangeActor, interchangeFailure, interchangeHeaders } from "@/features/interchange/server/http";
import { downloadInterchange } from "@/features/interchange/server/service";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(_request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const denied = await interchangeActor();
  if (denied) return denied;
  try {
    const result = await downloadInterchange((await context.params).jobId);
    return new Response(result.stream, {
      headers: {
        ...interchangeHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
      },
    });
  } catch (error) {
    return interchangeFailure(error);
  }
}
