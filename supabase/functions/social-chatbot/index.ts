import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TARGET = `${Deno.env.get("SUPABASE_URL") || ""}/functions/v1/meta-chatbot`;
const ALLOWED_ORIGINS = new Set([
  "https://www.striviodz.store",
  "https://striviodz.store",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://www.striviodz.store",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (!TARGET.startsWith("https://")) {
    return Response.json(
      { success: false, error: "Proxy configuration is incomplete" },
      { status: 503, headers: corsHeaders(req) },
    );
  }

  const incoming = new URL(req.url);
  const target = new URL(TARGET);
  target.search = incoming.search;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");

  try {
    const response = await fetch(target, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer(),
      redirect: "manual",
    });

    const responseHeaders = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders(req))) {
      responseHeaders.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Chatbot proxy failed", String(error?.message || error));
    return Response.json(
      { success: false, error: "Chatbot service is temporarily unavailable" },
      { status: 502, headers: corsHeaders(req) },
    );
  }
});
