import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateCertificateId } from "./certificate-id";

const createSchema = z.object({
  projectName: z.string().trim().min(1).max(120),
  screenVideoPath: z.string().trim().min(1).max(500),
  webcamVideoPath: z.string().trim().min(1).max(500),
  durationSeconds: z.number().int().min(0).max(60 * 60 * 24),
});

export const createCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Try a few times in the extremely unlikely event of a collision
    for (let attempt = 0; attempt < 5; attempt++) {
      const certificateId = generateCertificateId();
      const { data: row, error } = await supabase
        .from("certificates")
        .insert({
          certificate_id: certificateId,
          user_id: userId,
          project_name: data.projectName,
          screen_video_path: data.screenVideoPath,
          webcam_video_path: data.webcamVideoPath,
          duration_seconds: data.durationSeconds,
          verification_status: "verified",
        })
        .select("certificate_id, project_name, created_at")
        .single();
      if (!error && row) {
        return {
          certificateId: row.certificate_id,
          projectName: row.project_name,
          createdAt: row.created_at,
        };
      }
      if (error && !/duplicate key/i.test(error.message)) {
        throw new Error(error.message);
      }
    }
    throw new Error("Could not generate a unique certificate id. Please retry.");
  });

export const listMyCertificates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("certificates")
      .select("certificate_id, project_name, created_at, duration_seconds, verification_status")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { certificates: data ?? [] };
  });

const verifySchema = z.object({
  certificateId: z
    .string()
    .trim()
    .min(8)
    .max(40)
    .regex(/^CERT-[A-Z0-9-]+$/i, "Invalid certificate id format"),
});

export const verifyCertificate = createServerFn({ method: "POST" })
  .inputValidator((input) => verifySchema.parse(input))
  .handler(async ({ data }) => {
    const normalized = data.certificateId.toUpperCase();
    const { data: row, error } = await supabaseAdmin
      .from("public_certificates")
      .select("certificate_id, project_name, created_at, verification_status, duration_seconds")
      .eq("certificate_id", normalized)
      .maybeSingle();
    if (error) {
      console.error("verifyCertificate error:", error);
      return { found: false as const, error: "Lookup failed. Please try again." };
    }
    if (!row) return { found: false as const };
    return {
      found: true as const,
      certificate: {
        certificateId: row.certificate_id,
        projectName: row.project_name,
        createdAt: row.created_at,
        verificationStatus: row.verification_status,
        durationSeconds: row.duration_seconds,
      },
    };
  });
