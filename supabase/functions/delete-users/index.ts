import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Jeff, 2026-11-03: permanent delete of user accounts — used by User Management's
// "Remove" and by its "Inactive users" window. Deleting the login from Supabase Auth
// (auth.admin.deleteUser) needs the service-role key, so it lives here.
//
// What a delete takes with it (database foreign keys, checked 2026-11-03): the
// profile, store memberships, page overrides, clock in/out events and their edit
// history, leave requests, availability, study/quiz/training progress, message
// receipts, push subscriptions and uploaded documents are all deleted with the
// account. Things the person merely CREATED (announcements, formula items, quiz
// questions, support requests, roster entries, …) stay, just with no author.
// time_discrepancy_hides.hidden_by has no cascade — an account that hid
// time-discrepancy rows can't be deleted until that is dealt with, which is reported
// per person below rather than failing the whole batch.
//
// Auth: verify_jwt stays ON; the caller must also be an active admin or developer.
// Never deletes the caller themself, and only a developer can delete a developer.
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
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: "Not signed in." }, 401);
    const callerId = userData.user.id;
    const { data: caller } = await admin.from("profiles").select("role, is_active").eq("id", callerId).single();
    if (!caller || !caller.is_active || !["admin", "developer"].includes(caller.role)) {
      return json({ error: "Only an admin can permanently delete users." }, 403);
    }

    const { user_ids } = await req.json();
    if (!Array.isArray(user_ids) || user_ids.length === 0 || user_ids.length > 200) {
      return json({ error: "user_ids (1–200 ids) is required." }, 400);
    }

    const deleted: string[] = [];
    const failed: { id: string; name: string; error: string }[] = [];
    for (const id of user_ids.map(String)) {
      const { data: target } = await admin.from("profiles").select("first_name, last_name, email, role").eq("id", id).maybeSingle();
      const name = `${target?.first_name ?? ""} ${target?.last_name ?? ""}`.trim() || target?.email || id;
      if (id === callerId) {
        failed.push({ id, name, error: "You can't delete your own account." });
        continue;
      }
      if (target?.role === "developer" && caller.role !== "developer") {
        failed.push({ id, name, error: "Only a developer can delete a developer account." });
        continue;
      }
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        const blocked = /database error|foreign key|violates/i.test(error.message);
        failed.push({
          id,
          name,
          error: blocked
            ? "This account has records that block deletion (e.g. it hid time-discrepancy entries). Leave it inactive instead."
            : error.message,
        });
      } else {
        deleted.push(id);
      }
    }
    return json({ deleted, failed });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
