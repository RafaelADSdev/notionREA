import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getEnvironment } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";
import { isLocalMode, isSetupMode } from "@/lib/setup-mode";

export async function proxy(request: NextRequest) {
  const environment = isLocalMode() || isSetupMode() ? null : getEnvironment();
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64");
  const service = environment ? new URL(environment.NEXT_PUBLIC_SUPABASE_URL) : null;
  const websocket = service ? `${service.protocol === "https:" ? "wss:" : "ws:"}//${service.host}` : "";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${service?.origin ?? ""} ${websocket}`,
    "object-src 'none'",
    "worker-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  let response = NextResponse.next({ request: { headers } });
  if (!environment) {
    const path = request.nextUrl.pathname;
    if ((path.startsWith("/api/") && path !== "/api/health") || !["GET", "HEAD"].includes(request.method)) {
      response = NextResponse.json({ error: "setup-required" }, { status: 503 });
    } else if (path !== (isLocalMode() ? "/local" : "/setup") && path !== "/api/health") {
      const target = request.nextUrl.clone();
      target.pathname = isLocalMode() ? "/local" : "/setup";
      target.search = "";
      response = NextResponse.rewrite(target, { request: { headers } });
    }
    response.headers.set("Content-Security-Policy", policy);
    response.headers.set("Cache-Control", "private, no-store");
    if (request.nextUrl.protocol === "https:")
      response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    return response;
  }
  const client = createServerClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(environment.APP_URL).protocol === "https:",
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          for (const { name, value } of items) request.cookies.set(name, value);
          headers.set("cookie", request.cookies.toString());
          response = NextResponse.next({ request: { headers } });
          for (const { name, value, options } of items)
            response.cookies.set(name, value, { ...options, httpOnly: true });
        },
      },
    },
  );
  await client.auth.getClaims();
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store");
  if (new URL(environment.APP_URL).protocol === "https:")
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
