import { type NextRequest, NextResponse } from "next/server";
import { commentActor, commentFailure, commentHeaders } from "@/features/comments/http";
import { deleteComment, editComment } from "@/features/comments/server";
import { readBoundedJson } from "@/lib/http";

type Context = { params: Promise<{ commentId: string }> };
export async function PATCH(request: NextRequest, context: Context) {
  const auth = await commentActor(request);
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(
      await editComment((await context.params).commentId, await readBoundedJson(request, 65536)),
      { headers: commentHeaders },
    );
  } catch (error) {
    return commentFailure(error);
  }
}
export async function DELETE(request: NextRequest, context: Context) {
  const auth = await commentActor(request);
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(
      await deleteComment((await context.params).commentId, await readBoundedJson(request, 1024)),
      { headers: commentHeaders },
    );
  } catch (error) {
    return commentFailure(error);
  }
}
