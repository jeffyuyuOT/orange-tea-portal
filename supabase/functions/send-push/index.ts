import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Jeff, 2026-10-21: backing piece for full Web Push. Called from three DB
// triggers via net.http_post — notify_push_on_message() (message_recipients),
// notify_push_on_announcement() (announcements), notify_push_on_roster_change()
// (roster_change_events) — same net.http_post-from-a-trigger pattern already
// used by cleanup_profile_storage_files()/cleanup_sr_notify_delete() for
// delete-storage-files. All business logic (who to notify, what to say) lives
// in those trigger functions; this function is a thin, generic "send push to
// these profile ids" executor, same shape as delete-storage-files.
//
// Auth: verify_jwt stays on — callers (the DB triggers) pass the project's
// anon key, same non-sensitive boundary delete-storage-files already uses.
// The actual subscription lookup below uses this function's own
// SUPABASE_SERVICE_ROLE_KEY (auto-injected) so it can read every user's
// push_subscriptions regardless of RLS.
//
// VAPID_PUBLIC_KEY is not secret (it's sent to every browser as the
// applicationServerKey, same value hardcoded in src/lib/webPush.js) so it's
// a plain constant here rather than a secret lookup. VAPID_PRIVATE_KEY and
// VAPID_SUBJECT are real secrets, set via the Supabase dashboard (Edge
// Functions > Secrets) since Supabase's own tooling doesn't let a secret
// value pass through an AI client.
const VAPID_PUBLIC_KEY = "BI0iRe4qobR2_hADrmSanB3iNIpKOLEzFR7ZbHrkxxNrEwfE2GQNk_9SqjTH_yg2q7r3gqLe0pmTbNAtqxCg60Y";

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
    const { profileIds, title, body, url, tag } = await req.json();
    if (!Array.isArray(profileIds) || profileIds.length === 0 || !title || !body) {
      return json({ error: "profileIds (non-empty string[]), title and body are required" }, 400);
    }

    const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const subject = Deno.env.get("VAPID_SUBJECT");
    if (!privateKey || !subject) {
      return json({ error: "VAPID_PRIVATE_KEY / VAPID_SUBJECT are not set on this function" }, 500);
    }
    webpush.setVapidDetails(subject, VAPID_PUBLIC_KEY, privateKey);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("profile_id", profileIds);
    if (error) return json({ error: error.message }, 500);

    const payload = JSON.stringify({ title, body, url: url ?? "/", tag });
    let sent = 0;
    let failed = 0;
    const pruneIds: string[] = [];

    await Promise.all(
      (subs ?? []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          );
          sent++;
        } catch (err) {
          failed++;
          // 404/410 = the push service says this subscription is gone for good
          // (user revoked it, uninstalled, etc.) — standard web-push cleanup.
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) pruneIds.push(s.id);
        }
      })
    );

    if (pruneIds.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", pruneIds);
    }

    return json({ sent, failed, pruned: pruneIds.length });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
