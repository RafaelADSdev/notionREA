import { type NextRequest, NextResponse } from "next/server";
import { commentActor, commentFailure, commentHeaders } from "@/features/comments/http";
import { renewPagePresence } from "@/features/comments/server";
import { readBoundedJson } from "@/lib/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const auth = await commentActor(request);
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(
      await renewPagePresence((await params).pageId, await readBoundedJson(request, 1024)),
      { headers: commentHeaders },
    );
  } catch (error) {
    return commentFailure(error);
  }
}
