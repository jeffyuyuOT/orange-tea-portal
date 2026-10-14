import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// BK "匯入 by 圖檔": forwards a POS "Sale Summary > Payments" screenshot to the
// receipt scan service (POST /v1/scan-report) and returns its parsed result.
//
// Why a function and not a direct call from the browser: the scan service's API
// key must never reach the browser. It lives in this function's secrets:
//   SCAN_SERVICE_API_KEY   (required) the warehouse API key, sent as "Authorization: Bearer <key>"
//   SCAN_SERVICE_URL       (optional) defaults to https://receiptscan.orangetea.au
//
// Auth: verify_jwt stays on (a signed-in user is required), and on top of that the
// caller must be a developer (is_developer(), same boundary as Payroll / BK).
// Nothing is stored here: the image is streamed through and forgotten, and the
// debug fields (raw_markdown, items) are dropped from the response.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: isDev, error: devErr } = await supabase.rpc("is_developer");
    if (devErr || isDev !== true) return json({ error: "Developer only" }, 403);

    const key = Deno.env.get("SCAN_SERVICE_API_KEY");
    if (!key) return json({ error: "SCAN_SERVICE_API_KEY is not set on this function" }, 500);
    const base = (Deno.env.get("SCAN_SERVICE_URL") ?? "https://receiptscan.orangetea.au").replace(/\/+$/, "");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "file is required" }, 400);
    if (file.size > 8 * 1024 * 1024) return json({ error: "file is larger than 8MB" }, 413);

    const out = new FormData();
    out.append("file", file, file.name || "report.png");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000); // Docling can take a while on a cold start
    let resp: Response;
    try {
      resp = await fetch(`${base}/v1/scan-report`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: out,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await resp.text();
    if (!resp.ok) return json({ error: `Scan service returned ${resp.status}`, detail: text.slice(0, 300) }, 502);

    const result = JSON.parse(text);
    delete result.raw_markdown;
    delete result.items;
    return json(result);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
