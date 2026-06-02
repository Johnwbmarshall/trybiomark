import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Didit verification webhook.
 * Configure URL in Didit Dashboard → Settings → Webhooks:
 *   https://bio-mark-ca.lovable.app/api/public/didit/webhook
 *
 * Didit signs the raw request body with HMAC-SHA256 using
 * DIDIT_WEBHOOK_SECRET_KEY and sends it as `x-signature`.
 */
export const Route = createFileRoute("/api/public/didit/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.DIDIT_WEBHOOK_SECRET_KEY;
        if (!secret) {
          console.error("DIDIT_WEBHOOK_SECRET_KEY not configured");
          return new Response("Server misconfigured", { status: 500 });
        }

        const signature =
          request.headers.get("x-signature") ??
          request.headers.get("x-didit-signature");
        const timestamp = request.headers.get("x-timestamp");
        const body = await request.text();

        if (!signature) {
          return new Response("Missing signature", { status: 401 });
        }

        const expected = createHmac("sha256", secret)
          .update(body)
          .digest("hex");

        let sigOk = false;
        try {
          const a = Buffer.from(signature, "hex");
          const b = Buffer.from(expected, "hex");
          sigOk = a.length === b.length && timingSafeEqual(a, b);
        } catch {
          sigOk = false;
        }
        if (!sigOk) {
          return new Response("Invalid signature", { status: 401 });
        }

        // Reject events older than 5 minutes (replay protection).
        if (timestamp) {
          const ageSec = Math.abs(Date.now() / 1000 - Number(timestamp));
          if (Number.isFinite(ageSec) && ageSec > 300) {
            return new Response("Stale event", { status: 401 });
          }
        }

        let payload: {
          session_id?: string;
          status?: string;
          vendor_data?: string;
          decision?: unknown;
        };
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const { session_id, status, vendor_data } = payload;
        if (!session_id || !status) {
          return new Response("Missing fields", { status: 400 });
        }

        // Normalize Didit status → our internal kyc_status.
        const normalized =
          status === "Approved" || status === "approved"
            ? "verified"
            : status === "Declined" || status === "declined"
              ? "declined"
              : status === "In Review" || status === "in_review"
                ? "in_review"
                : "in_progress";

        const decisionJson = JSON.parse(body) as Record<string, unknown>;
        const update: {
          kyc_status: string;
          kyc_decision: Record<string, unknown>;
          kyc_verified_at?: string;
        } = {
          kyc_status: normalized,
          kyc_decision: decisionJson,
        };
        if (normalized === "verified") {
          update.kyc_verified_at = new Date().toISOString();
        }

        // Match on session id first; fall back to vendor_data (user_id).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query = supabaseAdmin.from("profiles").update(update as any);
        const { error } = vendor_data
          ? await query.or(
              `kyc_session_id.eq.${session_id},user_id.eq.${vendor_data}`,
            )
          : await query.eq("kyc_session_id", session_id);

        if (error) {
          console.error("Webhook DB update failed:", error.message);
          return new Response("DB error", { status: 500 });
        }

        return new Response("ok");
      },

      // Some providers send a verification GET. Respond 200 so they can register
      // the endpoint.
      GET: async () => new Response("ok"),
    },
  },
});
