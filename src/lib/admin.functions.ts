import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin access required");
}

export const listAllUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);

    // Page through auth users (admin API caps at 1000 per page; OK for now)
    const users: Array<{
      id: string;
      email: string | null;
      created_at: string;
      last_sign_in_at: string | null;
      banned_until: string | null;
      email_confirmed_at: string | null;
    }> = [];
    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      for (const u of data.users) {
        users.push({
          id: u.id,
          email: u.email ?? null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
          // @ts-expect-error banned_until is on the admin payload
          banned_until: u.banned_until ?? null,
          email_confirmed_at: u.email_confirmed_at ?? null,
        });
      }
      if (data.users.length < 200) break;
      page += 1;
      if (page > 25) break;
    }

    const userIds = users.map((u) => u.id);

    const [profilesRes, rolesRes, certsRes, appealsRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("user_id, kyc_status, kyc_verified_at, selfie_path, created_at")
        .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin
        .from("certificates")
        .select("user_id, certificate_id, verification_status, created_at, project_name")
        .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"])
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("verification_appeals")
        .select("user_id, status")
        .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
    ]);

    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (rolesRes.error) throw new Error(rolesRes.error.message);
    if (certsRes.error) throw new Error(certsRes.error.message);
    if (appealsRes.error) throw new Error(appealsRes.error.message);

    const profileByUser = new Map(profilesRes.data.map((p) => [p.user_id, p]));
    const rolesByUser = new Map<string, string[]>();
    for (const r of rolesRes.data) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    }
    const certsByUser = new Map<string, typeof certsRes.data>();
    for (const c of certsRes.data) {
      const arr = certsByUser.get(c.user_id) ?? [];
      arr.push(c);
      certsByUser.set(c.user_id, arr);
    }
    const appealsByUser = new Map<string, number>();
    for (const a of appealsRes.data) {
      appealsByUser.set(a.user_id, (appealsByUser.get(a.user_id) ?? 0) + 1);
    }

    return {
      users: users.map((u) => ({
        ...u,
        profile: profileByUser.get(u.id) ?? null,
        roles: rolesByUser.get(u.id) ?? [],
        certificates: certsByUser.get(u.id) ?? [],
        appealsCount: appealsByUser.get(u.id) ?? 0,
      })),
    };
  });

const userIdInput = z.object({ userId: z.string().uuid() });

export const sendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => userIdInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: u, error: getErr } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (getErr) throw new Error(getErr.message);
    const email = u.user?.email;
    if (!email) throw new Error("User has no email");
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetKyc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => userIdInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        kyc_status: "not_started",
        kyc_session_id: null,
        kyc_session_url: null,
        kyc_verified_at: null,
        kyc_decision: null,
      })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const suspendInput = z.object({
  userId: z.string().uuid(),
  suspend: z.boolean(),
});

export const setUserSuspended = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => suspendInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId) throw new Error("Cannot suspend your own account");
    // ban_duration: '876000h' (~100y) to suspend; 'none' to lift
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.suspend ? "876000h" : "none",
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => userIdInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId) throw new Error("Cannot delete your own account");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const updateEmailInput = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
});

export const updateUserEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => updateEmailInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      email: data.email,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    return { isAdmin: !!data };
  });
