import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DIDIT_API_BASE = "https://verification.didit.me";

/**
 * Creates (or returns the existing) Didit KYC verification session for the
 * signed-in user. Persists the session id/url on the user's profile so the
 * webhook can correlate the callback back to the user.
 */
export const startDiditVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const apiKey = process.env.DIDIT_API_KEY;
    const workflowId = process.env.DIDIT_WORKFLOW_ID;
    if (!apiKey || !workflowId) {
      throw new Error("Identity verification is not configured.");
    }

    // If user already has an open / pending session, reuse it.
    const { data: existing } = await supabase
      .from("profiles")
      .select("kyc_status, kyc_session_id, kyc_session_url")
      .eq("user_id", userId)
      .maybeSingle();

    if (
      existing?.kyc_status === "verified" &&
      existing?.kyc_session_url
    ) {
      return {
        sessionId: existing.kyc_session_id,
        url: existing.kyc_session_url,
        status: "verified" as const,
      };
    }

    if (
      existing?.kyc_session_url &&
      (existing.kyc_status === "in_progress" ||
        existing.kyc_status === "pending")
    ) {
      return {
        sessionId: existing.kyc_session_id,
        url: existing.kyc_session_url,
        status: existing.kyc_status,
      };
    }

    const res = await fetch(`${DIDIT_API_BASE}/v2/session/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        workflow_id: workflowId,
        vendor_data: userId,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("Didit session create failed:", res.status, text);
      throw new Error(
        `Could not start identity verification (${res.status}).`,
      );
    }

    const json = (await res.json()) as {
      session_id?: string;
      url?: string;
      status?: string;
    };

    if (!json.session_id || !json.url) {
      throw new Error("Identity provider returned an invalid session.");
    }

    // Use admin client so we can update regardless of any future RLS tightening.
    const { error: upErr } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          user_id: userId,
          kyc_status: "in_progress",
          kyc_session_id: json.session_id,
          kyc_session_url: json.url,
        },
        { onConflict: "user_id" },
      );
    if (upErr) throw new Error(upErr.message);

    return {
      sessionId: json.session_id,
      url: json.url,
      status: json.status ?? "in_progress",
    };
  });
