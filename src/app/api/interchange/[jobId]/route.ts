import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { interchangeActor, interchangeFailure, interchangeHeaders } from "@/features/interchange/server/http";
import { commandInterchange, interchangeStatus } from "@/features/interchange/server/service";
import { readBoundedJson } from "@/lib/http";

type Context = { params: Promise<{ jobId: string }> };
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest, context: Context) {
  const denied = await interchangeActor();
  if (denied) return denied;
  try {
    const args = z
      .strictObject({ afterIndex: z.coerce.number().int().min(-1).max(100000000).default(-1) })
      .parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await interchangeStatus((await context.params).jobId, args.afterIndex), {
      headers: interchangeHeaders,
    });
  } catch (error) {
    return interchangeFailure(error);
  }
}
export async function POST(request: NextRequest, context: Context) {
  const denied = await interchangeActor(request);
  if (denied) return denied;
  try {
    return NextResponse.json(
      await commandInterchange((await context.params).jobId, await readBoundedJson(request, 262144)),
      { headers: interchangeHeaders },
    );
  } catch (error) {
    return interchangeFailure(error);
  }
}
