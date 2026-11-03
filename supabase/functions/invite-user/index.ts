import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Jeff, 2026-11-03: backs the "+ Invite user" buttons in Admin Center > User
// Management and Shop Management > Staff Information. Sending a Supabase invite
// (auth.admin.inviteUserByEmail) needs the service-role key, which must never
// reach the browser, so it lives here.
//
// Auth: verify_jwt stays ON, and the caller is looked up in `profiles` here too.
//
// Two modes:
//  • default (User Management): admin / developer only. Creates the login + sends the
//    invite email; the browser then writes role / store(s) itself under the admin's
//    own permissions (the signup trigger makes the profile as role 'staff').
//  • mode "store_staff" (Staff Information): admin / developer, or a shop manager who
//    belongs to `store_id`. Can ONLY create a plain 'staff' account on that one
//    store — a shop manager has no permission to write another person's profile from
//    the browser, so this function does it (first/last name, role staff, store,
//    store membership hidden from the roster until a manager restores them). If any
//    of that fails, the just-invited login is deleted again so no half-made account
//    is left behind.
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
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Who is calling?
    // getUser() asks Supabase Auth whether this session is still live. That matters:
    // signing out revokes the session on the server, but a token from it still passes
    // the platform's own signature check until it expires - so without this, a
    // signed-out browser tab could still run these functions (2026-11-03: exactly
    // what a stale, signed-out tab did while testing).
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) {
      return json({ error: "Your sign-in has expired. Sign out, sign in again, then retry." }, 401);
    }
    const callerId = userData.user.id;
    const { data: caller, error: callerError } = await admin
      .from("profiles")
      .select("role, is_active, primary_store_id")
      .eq("id", callerId)
      .single();
    if (callerError) return json({ error: `Could not check your permissions: ${callerError.message}` }, 500);
    if (!caller || !caller.is_active) return json({ error: "Not allowed." }, 403);
    const isAdmin = ["admin", "developer"].includes(caller.role);

    const body = await req.json();
    const { email, redirectTo, mode } = body;
    const storeStaff = mode === "store_staff";

    let storeId = "";
    if (storeStaff) {
      storeId = String(body.store_id ?? "");
      if (!storeId) return json({ error: "Store is required." }, 400);
      if (!isAdmin) {
        if (caller.role !== "shop_manager") return json({ error: "Only a shop manager or admin can invite staff." }, 403);
        const { data: memberships } = await admin.from("user_stores").select("store_id").eq("profile_id", callerId);
        const mine = new Set((memberships ?? []).map((m: { store_id: string }) => m.store_id));
        if (caller.primary_store_id) mine.add(caller.primary_store_id);
        if (!mine.has(storeId)) return json({ error: "You can only invite staff to your own store." }, 403);
      }
    } else if (!isAdmin) {
      return json({ error: "Only an admin can invite users." }, 403);
    }

    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return json({ error: "Enter a valid email address." }, 400);

    const { data, error } = await admin.auth.admin.inviteUserByEmail(cleanEmail, {
      redirectTo: typeof redirectTo === "string" && redirectTo ? redirectTo : undefined,
    });
    if (error) {
      const already = /already (been )?registered|already exists/i.test(error.message);
      return json(
        {
          error: already
            ? "That email already has an account. Find them in User Management and use Reset password instead."
            : error.message,
        },
        already ? 409 : 400,
      );
    }
    const newId = data.user.id;

    if (storeStaff) {
      const rollback = async (msg: string) => {
        await admin.auth.admin.deleteUser(newId);
        return json({ error: `Could not set up the new staff account (${msg}). Nothing was created.` }, 500);
      };
      const { error: profileError } = await admin
        .from("profiles")
        .update({
          first_name: String(body.first_name ?? "").trim(),
          last_name: String(body.last_name ?? "").trim(),
          role: "staff",
          primary_store_id: storeId,
        })
        .eq("id", newId);
      if (profileError) return await rollback(profileError.message);

      const { data: store } = await admin.from("stores").select("disable_roster").eq("id", storeId).single();
      const { data: have } = await admin.from("user_stores").select("store_id").eq("profile_id", newId);
      if (!(have ?? []).some((r: { store_id: string }) => r.store_id === storeId)) {
        const { error: storeError } = await admin.from("user_stores").insert({
          profile_id: newId,
          store_id: storeId,
          hidden_from_roster: true,
          can_view_roster_tab: !store?.disable_roster,
        });
        if (storeError) return await rollback(storeError.message);
      }
    }

    return json({ user_id: newId, email: cleanEmail });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
