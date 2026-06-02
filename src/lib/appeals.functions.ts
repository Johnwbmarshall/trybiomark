import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TEMPLATES } from "@/lib/email-templates/registry";
import { generateCertificateId } from "./certificate-id";

const REVIEWER_EMAIL = "johnwbmarshall@gmail.com";

function siteOrigin(): string {
  return (
    process.env.SITE_URL ??
    process.env.VITE_SITE_URL ??
    "https://bio-mark.ca"
  );
}

const SITE_NAME = "trybiomark";
const SENDER_DOMAIN = "notify.bio-mark.ca";
const FROM_DOMAIN = "bio-mark.ca";

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function enqueueEmail(args: {
  templateName: string;
  recipientEmail: string;
  templateData: Record<string, unknown>;
  idempotencyKey?: string;
}) {
  const entry = TEMPLATES[args.templateName];
  if (!entry) throw new Error(`Unknown email template: ${args.templateName}`);

  const recipient = (entry.to ?? args.recipientEmail).trim();
  const normalizedEmail = recipient.toLowerCase();

  const { data: suppressed } = await supabaseAdmin
    .from("suppressed_emails")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (suppressed) return;

  let unsubscribeToken: string;
  const { data: existingToken } = await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .select("token, used_at")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (existingToken && !existingToken.used_at) {
    unsubscribeToken = existingToken.token;
  } else {
    unsubscribeToken = generateToken();
    await supabaseAdmin
      .from("email_unsubscribe_tokens")
      .upsert(
        { token: unsubscribeToken, email: normalizedEmail },
        { onConflict: "email", ignoreDuplicates: true },
      );
    const { data: stored } = await supabaseAdmin
      .from("email_unsubscribe_tokens")
      .select("token")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (stored?.token) unsubscribeToken = stored.token;
  }

  const React = await import("react");
  const { render } = await import("@react-email/components");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = React.createElement(entry.component as any, args.templateData);
  const html = await render(element);
  const text = await render(element, { plainText: true });
  const subject =
    typeof entry.subject === "function"
      ? entry.subject(args.templateData)
      : entry.subject;

  const messageId = crypto.randomUUID();
  const idempotencyKey = args.idempotencyKey ?? messageId;

  await supabaseAdmin.from("email_send_log").insert({
    message_id: messageId,
    template_name: args.templateName,
    recipient_email: recipient,
    status: "pending",
  });

  const { error } = await supabaseAdmin.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      message_id: messageId,
      to: recipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text,
      purpose: "transactional",
      label: args.templateName,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  });
  if (error) throw new Error(`enqueue_email failed: ${error.message}`);
}

const checkSchema = z.object({
  key: z.string(),
  label: z.string(),
  passed: z.boolean(),
  confidence: z.enum(["low", "medium", "high"]),
  reason: z.string(),
});

// ---------- submit appeal ----------

const submitSchema = z.object({
  projectName: z.string().trim().min(1).max(120),
  screenVideoPath: z.string().trim().min(1).max(500),
  webcamVideoPath: z.string().trim().min(1).max(500),
  originalPdfPath: z.string().trim().min(1).max(500),
  durationSeconds: z.number().int().min(0).max(60 * 60 * 24),
  geminiChecks: z.array(checkSchema).min(1),
  geminiSummary: z.string().max(2000).default(""),
  userNote: z.string().trim().max(2000).optional(),
});

export const submitAppeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => submitSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: userInfo } = await supabaseAdmin.auth.admin.getUserById(userId);
    const userEmail = userInfo?.user?.email ?? null;

    const token = generateToken();

    const { data: row, error } = await supabaseAdmin
      .from("verification_appeals")
      .insert({
        decision_token: token,
        user_id: userId,
        user_email: userEmail,
        project_name: data.projectName,
        duration_seconds: data.durationSeconds,
        screen_video_path: data.screenVideoPath,
        webcam_video_path: data.webcamVideoPath,
        original_pdf_path: data.originalPdfPath,
        gemini_checks: data.geminiChecks,
        gemini_summary: data.geminiSummary ?? "",
        user_note: data.userNote ?? null,
        reviewer_email: REVIEWER_EMAIL,
      })
      .select("id, decision_token")
      .single();
    if (error || !row) {
      throw new Error(error?.message ?? "Could not create appeal.");
    }

    const sevenDays = 60 * 60 * 24 * 7;
    const sign = async (bucket: string, path: string) => {
      const { data: s } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(path, sevenDays);
      return s?.signedUrl ?? null;
    };
    const [screenUrl, webcamUrl, pdfUrl] = await Promise.all([
      sign("recordings", data.screenVideoPath),
      sign("recordings", data.webcamVideoPath),
      sign("documents", data.originalPdfPath),
    ]);

    await enqueueEmail({
      templateName: "appeal-submitted",
      recipientEmail: REVIEWER_EMAIL,
      idempotencyKey: `appeal-submitted-${row.id}`,
      templateData: {
        projectName: data.projectName,
        userEmail: userEmail ?? "unknown",
        userNote: data.userNote ?? "",
        geminiSummary: data.geminiSummary ?? "",
        checks: data.geminiChecks,
        reviewUrl: `${siteOrigin()}/appeals/${row.decision_token}`,
        screenUrl,
        webcamUrl,
        pdfUrl,
      },
    });

    return { ok: true, appealId: row.id };
  });

// ---------- fetch appeal by token (reviewer page) ----------

const tokenSchema = z.object({
  token: z.string().trim().min(20).max(128).regex(/^[a-f0-9]+$/i),
});

export const getAppeal = createServerFn({ method: "POST" })
  .inputValidator((input) => tokenSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("verification_appeals")
      .select(
        "id, project_name, user_email, user_note, gemini_checks, gemini_summary, status, reviewer_notes, certificate_id, screen_video_path, webcam_video_path, original_pdf_path, duration_seconds, created_at, expires_at",
      )
      .eq("decision_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { found: false as const };

    const expired = new Date(row.expires_at).getTime() < Date.now();

    const sevenDays = 60 * 60 * 24 * 7;
    const sign = async (bucket: string, path: string | null) => {
      if (!path) return null;
      const { data: s } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(path, sevenDays);
      return s?.signedUrl ?? null;
    };
    const [screenUrl, webcamUrl, pdfUrl] = await Promise.all([
      sign("recordings", row.screen_video_path),
      sign("recordings", row.webcam_video_path),
      sign("documents", row.original_pdf_path),
    ]);

    return {
      found: true as const,
      appeal: {
        projectName: row.project_name,
        userEmail: row.user_email,
        userNote: row.user_note,
        checks: (row.gemini_checks ?? []) as Array<{
          key: string;
          label: string;
          passed: boolean;
          confidence: "low" | "medium" | "high";
          reason: string;
        }>,
        summary: row.gemini_summary ?? "",
        status: row.status as "pending" | "approved" | "denied",
        reviewerNotes: row.reviewer_notes,
        certificateId: row.certificate_id,
        durationSeconds: row.duration_seconds,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        expired,
        screenUrl,
        webcamUrl,
        pdfUrl,
      },
    };
  });

// ---------- decide appeal (reviewer) ----------

const decideSchema = z.object({
  token: z.string().trim().min(20).max(128).regex(/^[a-f0-9]+$/i),
  decision: z.enum(["approved", "denied"]),
  reviewerNotes: z.string().trim().max(2000).optional(),
});

export const decideAppeal = createServerFn({ method: "POST" })
  .inputValidator((input) => decideSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("verification_appeals")
      .select(
        "id, user_id, user_email, project_name, duration_seconds, screen_video_path, webcam_video_path, original_pdf_path, gemini_checks, gemini_summary, status, expires_at",
      )
      .eq("decision_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Appeal not found.");
    if (row.status !== "pending") {
      throw new Error(`This appeal has already been ${row.status}.`);
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error("This appeal has expired.");
    }

    let issuedCertificateId: string | null = null;
    let combinedPdfPath: string | null = null;
    let downloadUrl: string | null = null;

    if (data.decision === "approved") {
      // Issue a certificate row.
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateCertificateId();
        const { error: insErr } = await supabaseAdmin
          .from("certificates")
          .insert({
            certificate_id: candidate,
            user_id: row.user_id,
            project_name: row.project_name,
            screen_video_path: row.screen_video_path,
            webcam_video_path: row.webcam_video_path,
            duration_seconds: row.duration_seconds,
            verification_status: "verified",
            document_pdf_path: row.original_pdf_path,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            verification_notes: {
              checks: row.gemini_checks,
              summary: row.gemini_summary,
              appeal: {
                reviewedBy: REVIEWER_EMAIL,
                reviewerNotes: data.reviewerNotes ?? "",
                reversedAt: new Date().toISOString(),
              },
            } as any,
          });
        if (!insErr) {
          issuedCertificateId = candidate;
          break;
        }
        if (!/duplicate key/i.test(insErr.message)) {
          throw new Error(insErr.message);
        }
      }
      if (!issuedCertificateId) {
        throw new Error("Could not issue a certificate id.");
      }

      // Build combined PDF (original + certificate page) server-side.
      try {
        const { generateCombinedPdf } = await import("@/lib/certificate-pdf");
        const { data: originalBlob } = await supabaseAdmin.storage
          .from("documents")
          .download(row.original_pdf_path);
        if (originalBlob) {
          const combined = await generateCombinedPdf(originalBlob, {
            certificateId: issuedCertificateId,
            projectName: row.project_name,
            createdAt: new Date().toISOString(),
            ownerEmail: row.user_email,
            checks: row.gemini_checks as never,
            summary: row.gemini_summary,
            baseUrl: siteOrigin(),
          });
          combinedPdfPath = `${row.user_id}/${Date.now()}-${issuedCertificateId}-combined.pdf`;
          const arrayBuf = await combined.arrayBuffer();
          const up = await supabaseAdmin.storage
            .from("documents")
            .upload(combinedPdfPath, new Uint8Array(arrayBuf), {
              contentType: "application/pdf",
            });
          if (up.error) {
            console.error("appeal combined pdf upload failed", up.error);
            combinedPdfPath = null;
          } else {
            await supabaseAdmin
              .from("certificates")
              .update({ combined_pdf_path: combinedPdfPath })
              .eq("certificate_id", issuedCertificateId);
          }
        }
      } catch (e) {
        console.error("appeal combined pdf generation failed", e);
      }

      const downloadPath = combinedPdfPath ?? row.original_pdf_path;
      const { data: signed } = await supabaseAdmin.storage
        .from("documents")
        .createSignedUrl(downloadPath, 60 * 60 * 24 * 30);
      downloadUrl = signed?.signedUrl ?? null;
    }

    const { error: updErr } = await supabaseAdmin
      .from("verification_appeals")
      .update({
        status: data.decision,
        reviewer_notes: data.reviewerNotes ?? null,
        decided_at: new Date().toISOString(),
        certificate_id: issuedCertificateId,
      })
      .eq("id", row.id);
    if (updErr) throw new Error(updErr.message);

    // Email the user.
    if (row.user_email) {
      const templateData: Record<string, unknown> = {
        projectName: row.project_name,
        decision: data.decision,
        reviewerNotes: data.reviewerNotes ?? "",
      };
      if (data.decision === "approved" && issuedCertificateId) {
        templateData.certificateId = issuedCertificateId;
        templateData.verifyUrl = `${siteOrigin()}/verify/${issuedCertificateId}`;
        templateData.downloadUrl = downloadUrl;
      }
      try {
        await enqueueEmail({
          templateName: "appeal-decision",
          recipientEmail: row.user_email,
          idempotencyKey: `appeal-decision-${row.id}`,
          templateData,
        });
      } catch (e) {
        console.error("appeal decision email failed", e);
      }
    }

    return {
      ok: true,
      decision: data.decision,
      certificateId: issuedCertificateId,
    };
  });
