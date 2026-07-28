import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TARGET = `${Deno.env.get("SUPABASE_URL") || ""}/functions/v1/meta-chatbot`;

serve(async (req) => {
  if (!TARGET.startsWith("https://")) {
    return Response.json(
      { success: false, error: "Proxy configuration is incomplete" },
      { status: 503 },
    );
  }

  const incoming = new URL(req.url);
  const target = new URL(TARGET);
  target.search = incoming.search;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");

  const response = await fetch(target, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer(),
    redirect: "manual",
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});
