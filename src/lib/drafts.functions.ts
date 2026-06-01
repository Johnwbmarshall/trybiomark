import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createSchema = z.object({
  projectName: z.string().trim().min(1).max(120),
  screenVideoPath: z.string().trim().min(1).max(500),
  webcamVideoPath: z.string().trim().min(1).max(500),
  durationSeconds: z.number().int().min(0).max(60 * 60 * 24),
});

const idSchema = z.object({
  id: z.string().uuid(),
});

export const createDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("recording_drafts")
      .insert({
        user_id: userId,
        project_name: data.projectName,
        screen_video_path: data.screenVideoPath,
        webcam_video_path: data.webcamVideoPath,
        duration_seconds: data.durationSeconds,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Failed to save draft");
    return { id: row.id };
  });

export const listMyDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("recording_drafts")
      .select("id, project_name, duration_seconds, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { drafts: data ?? [] };
  });

export const getDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("recording_drafts")
      .select("id, project_name, screen_video_path, webcam_video_path, duration_seconds, created_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Draft not found");
    return { draft: row };
  });

export const deleteDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("recording_drafts")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
