import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL || "http://localhost:8000";

async function proxy(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${API_URL}/${path.join("/")}${request.nextUrl.search}`;

  const isBodyMethod = !["GET", "HEAD"].includes(request.method);
  const contentType = request.headers.get("content-type") ?? "application/json";

  let body: string | undefined;
  if (isBodyMethod) {
    body = await request.text();
  }

  const resp = await fetch(url, {
    method: request.method,
    headers: isBodyMethod && body ? { "content-type": contentType } : {},
    body: isBodyMethod && body ? body : undefined,
  });

  const respContentType = resp.headers.get("content-type") ?? "application/json";

  if (respContentType.includes("text/event-stream")) {
    return new NextResponse(resp.body, {
      status: resp.status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  }

  const respText = await resp.text();
  return new NextResponse(respText, {
    status: resp.status,
    headers: { "content-type": respContentType },
  });
}

export const GET    = proxy;
export const POST   = proxy;
export const PUT    = proxy;
export const PATCH  = proxy;
export const DELETE = proxy;
