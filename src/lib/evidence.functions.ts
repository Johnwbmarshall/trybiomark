import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TEMPLATES } from "@/lib/email-templates/registry";

// ---------- helpers ----------

function siteOrigin(): string {
  // Prefer an explicit env, fall back to the production site.
  return (
    process.env.SITE_URL ??
    process.env.VITE_SITE_URL ??
    "https://bio-mark.ca"
  );
}

async function enqueueEmail(args: {
  templateName: string;
  recipientEmail: string;
  templateData: Record<string, unknown>;
  idempotencyKey?: string;
}) {
  // Render template -> enqueue via existing auth_emails-style RPC. The
  // existing transactional send route handles rendering + enqueue, but
  // it requires a user JWT. From the server we use the same primitives
  // directly via the admin client + the email-js renderer.
  const entry = TEMPLATES[args.templateName];
  if (!entry) throw new Error(`Unknown email template: ${args.templateName}`);

  const subject =
    typeof entry.subject === "function"
      ? entry.subject(args.templateData)
      : entry.subject;

  // Lazy-import the renderer to keep the server fn slim.
  const { render } = await import("@react-email/render");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Component = entry.component as any;
  const element = Component(args.templateData);
  const html = await render(element);
  const text = await render(element, { plainText: true });

  const payload = {
    to: entry.to ?? args.recipientEmail,
    subject,
    html,
    text,
    template_name: args.templateName,
    idempotency_key: args.idempotencyKey,
  };

  const { error } = await supabaseAdmin.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload,
  });
  if (error) throw new Error(`enqueue_email failed: ${error.message}`);
}

// ---------- request evidence ----------

const requestSchema = z.object({
  certificateId: z
    .string()
    .trim()
    .min(8)
    .max(40)
    .regex(/^CERT-[A-Z0-9-]+$/i, "Invalid certificate id"),
  requesterName: z.string().trim().min(1).max(120),
  requesterEmail: z.string().trim().email().max(255),
  reason: z.string().trim().min(10).max(2000),
});

export const requestEvidence = createServerFn({ method: "POST" })
  .inputValidator((input) => requestSchema.parse(input))
  .handler(async ({ data }) => {
    const normalized = data.certificateId.toUpperCase();

    // Look up the certificate (admin client — no RLS).
    const { data: cert, error: certErr } = await supabaseAdmin
      .from("certificates")
      .select("certificate_id, project_name, user_id")
      .eq("certificate_id", normalized)
      .maybeSingle();
    if (certErr) throw new Error(certErr.message);
    if (!cert) throw new Error("Certificate not found.");

    // Generate a strong opaque token.
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");

    const { data: row, error: insErr } = await supabaseAdmin
      .from("evidence_requests")
      .insert({
        certificate_id: cert.certificate_id,
        owner_user_id: cert.user_id,
        requester_email: data.requesterEmail,
        requester_name: data.requesterName,
        requester_reason: data.reason,
        decision_token: token,
      })
      .select("id, decision_token")
      .single();
    if (insErr || !row) {
      throw new Error(insErr?.message ?? "Could not create request.");
    }

    // Look up owner email.
    const { data: owner, error: ownerErr } =
      await supabaseAdmin.auth.admin.getUserById(cert.user_id);
    if (ownerErr || !owner?.user?.email) {
      throw new Error("Could not contact certificate owner.");
    }

    await enqueueEmail({
      templateName: "evidence-request",
      recipientEmail: owner.user.email,
      idempotencyKey: `evidence-request-${row.id}`,
      templateData: {
        projectName: cert.project_name,
        certificateId: cert.certificate_id,
        requesterName: data.requesterName,
        requesterEmail: data.requesterEmail,
        requesterReason: data.reason,
        decisionUrl: `${siteOrigin()}/evidence/${row.decision_token}`,
      },
    });

    return { ok: true };
  });

// ---------- fetch a request by token (for decision page) ----------

const tokenSchema = z.object({
  token: z.string().trim().min(20).max(128).regex(/^[a-f0-9]+$/i),
});

export const getEvidenceRequest = createServerFn({ method: "POST" })
  .inputValidator((input) => tokenSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("evidence_requests")
      .select(
        "id, certificate_id, requester_name, requester_email, requester_reason, status, expires_at, created_at",
      )
      .eq("decision_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { found: false as const };

    // Resolve project name for context.
    const { data: cert } = await supabaseAdmin
      .from("certificates")
      .select("project_name")
      .eq("certificate_id", row.certificate_id)
      .maybeSingle();

    const expired = new Date(row.expires_at).getTime() < Date.now();

    return {
      found: true as const,
      request: {
        certificateId: row.certificate_id,
        projectName: cert?.project_name ?? "Untitled",
        requesterName: row.requester_name,
        requesterEmail: row.requester_email,
        requesterReason: row.requester_reason,
        status: row.status as "pending" | "approved" | "denied",
        expiresAt: row.expires_at,
        expired,
        createdAt: row.created_at,
      },
    };
  });

// ---------- decide (approve / deny) ----------

const decideSchema = z.object({
  token: z.string().trim().min(20).max(128).regex(/^[a-f0-9]+$/i),
  decision: z.enum(["approved", "denied"]),
});

export const decideEvidenceRequest = createServerFn({ method: "POST" })
  .inputValidator((input) => decideSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("evidence_requests")
      .select(
        "id, certificate_id, requester_email, status, expires_at, owner_user_id",
      )
      .eq("decision_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Request not found.");
    if (row.status !== "pending") {
      throw new Error(`This request has already been ${row.status}.`);
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error("This request has expired.");
    }

    const { data: cert, error: certErr } = await supabaseAdmin
      .from("certificates")
      .select(
        "project_name, screen_video_path, webcam_video_path, document_pdf_path, combined_pdf_path",
      )
      .eq("certificate_id", row.certificate_id)
      .maybeSingle();
    if (certErr) throw new Error(certErr.message);
    if (!cert) throw new Error("Certificate not found.");

    // Update status.
    const { error: updErr } = await supabaseAdmin
      .from("evidence_requests")
      .update({ status: data.decision, decided_at: new Date().toISOString() })
      .eq("id", row.id);
    if (updErr) throw new Error(updErr.message);

    // Build signed URLs (7 days) when approved.
    let templateData: Record<string, unknown> = {
      projectName: cert.project_name,
      certificateId: row.certificate_id,
      decision: data.decision,
    };

    if (data.decision === "approved") {
      const sevenDays = 60 * 60 * 24 * 7;
      const signOne = async (bucket: string, path: string | null) => {
        if (!path) return null;
        const { data: s } = await supabaseAdmin.storage
          .from(bucket)
          .createSignedUrl(path, sevenDays);
        return s?.signedUrl ?? null;
      };
      const [screenUrl, webcamUrl, pdfUrl] = await Promise.all([
        signOne("recordings", cert.screen_video_path),
        signOne("recordings", cert.webcam_video_path),
        signOne(
          "documents",
          cert.document_pdf_path ?? cert.combined_pdf_path,
        ),
      ]);
      templateData = { ...templateData, screenUrl, webcamUrl, pdfUrl };
    }

    await enqueueEmail({
      templateName: "evidence-decision",
      recipientEmail: row.requester_email,
      idempotencyKey: `evidence-decision-${row.id}`,
      templateData,
    });

    return { ok: true, decision: data.decision };
  });
