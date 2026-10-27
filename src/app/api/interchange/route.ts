import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { interchangeActor, interchangeFailure, interchangeHeaders } from "@/features/interchange/server/http";
import { createInterchange, listInterchange } from "@/features/interchange/server/service";
import { readBoundedJson } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const denied = await interchangeActor();
  if (denied) return denied;
  try {
    const args = z
      .strictObject({ workspaceId: z.uuid(), cursor: z.string().max(512).optional() })
      .parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listInterchange(args.workspaceId, args.cursor), {
      headers: interchangeHeaders,
    });
  } catch (error) {
    return interchangeFailure(error);
  }
}
export async function POST(request: NextRequest) {
  const denied = await interchangeActor(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await createInterchange(await readBoundedJson(request, 16384)), {
      headers: interchangeHeaders,
    });
  } catch (error) {
    return interchangeFailure(error);
  }
}
