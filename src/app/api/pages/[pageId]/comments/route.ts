import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { commentActor, commentFailure, commentHeaders } from "@/features/comments/http";
import { createCommentThread, listCommentThreads } from "@/features/comments/server";
import { readBoundedJson } from "@/lib/http";

type Context = { params: Promise<{ pageId: string }> };
export async function GET(request: NextRequest, context: Context) {
  const auth = await commentActor();
  if (auth.response) return auth.response;
  try {
    const { cursor } = z
      .strictObject({ cursor: z.string().max(512).optional() })
      .parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listCommentThreads((await context.params).pageId, auth.actor.id, cursor), {
      headers: commentHeaders,
    });
  } catch (error) {
    return commentFailure(error);
  }
}
export async function POST(request: NextRequest, context: Context) {
  const auth = await commentActor(request);
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(
      await createCommentThread((await context.params).pageId, await readBoundedJson(request, 65536)),
      { headers: commentHeaders },
    );
  } catch (error) {
    return commentFailure(error);
  }
}
