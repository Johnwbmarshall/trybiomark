import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const frame = z
  .string()
  .trim()
  .min(50)
  .max(2_500_000)
  .regex(/^data:image\/(jpeg|png|webp);base64,/);

const schema = z.object({
  certificateId: z
    .string()
    .trim()
    .regex(/^CERT-[A-Z0-9-]+$/i, "Invalid certificate id")
    .optional(),
  screenFrames: z.array(frame).min(1).max(40),
  webcamFrames: z.array(frame).min(1).max(20),
  pdfPageImages: z.array(frame).min(1).max(10),
  // Optional audio (mp3/wav/webm), data URL
  audioDataUrl: z
    .string()
    .regex(/^data:audio\/(mpeg|mp3|wav|webm|ogg);base64,/)
    .max(8_500_000)
    .optional(),
  durationSeconds: z.number().int().min(0).max(60 * 60 * 24),
  projectName: z.string().trim().min(1).max(120),
});

const CHECK_KEYS = [
  "document_matches_recording",
  "person_matches_selfie",
  "no_transcription_audio",
  "no_other_people_in_frame",
  "video_and_output_consistent",
  "no_ai_generation_evidence",
] as const;

type CheckKey = (typeof CHECK_KEYS)[number];

export interface CheckResult {
  key: CheckKey;
  label: string;
  passed: boolean;
  confidence: "low" | "medium" | "high";
  reason: string;
}

const LABELS: Record<CheckKey, string> = {
  document_matches_recording:
    "The PDF matches what was created on screen",
  person_matches_selfie:
    "The person on camera matches the profile selfie",
  no_transcription_audio:
    "No suspicious audio indicating the document was being transcribed/dictated",
  no_other_people_in_frame:
    "No additional people appear in the webcam at any point",
  video_and_output_consistent:
    "Screen recording, webcam, and final document are consistent — no large blocks of text appearing suddenly",
  no_ai_generation_evidence:
    "No evidence of AI being used to generate the document content",
};

export const verifySubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    // 1. Get the user's selfie path from their profile.
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("selfie_path")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileErr) throw new Error(profileErr.message);
    if (!profile?.selfie_path) {
      throw new Error(
        "No verification selfie on file. Please add one in your profile first.",
      );
    }

    // 2. Download the selfie and convert to a data URL.
    const { data: selfieBlob, error: selfieErr } = await supabase.storage
      .from("selfies")
      .download(profile.selfie_path);
    if (selfieErr || !selfieBlob) {
      throw new Error(selfieErr?.message ?? "Could not load profile selfie.");
    }
    const selfieBuf = new Uint8Array(await selfieBlob.arrayBuffer());
    const selfieB64 = btoaBytes(selfieBuf);
    const selfieMime = selfieBlob.type || "image/jpeg";
    const selfieDataUrl = `data:${selfieMime};base64,${selfieB64}`;

    // 3. Build the multimodal message.
    const labelEntries = CHECK_KEYS.map(
      (k, i) => `  ${i + 1}. ${k} — ${LABELS[k]}`,
    ).join("\n");

    const systemPrompt = `You are the verification engine for Bio Mark, which issues human-authorship certificates.
You must evaluate a submission across SIX strict checks and call the report tool exactly once with all six results.

CHECKS:
${labelEntries}

EVALUATION RULES:
- For person_matches_selfie: compare the profile selfie image (labeled SELFIE) against the people visible in the WEBCAM frames. Pass only if it is plausibly the same person.
- For no_other_people_in_frame: if any webcam frame shows additional people, fail.
- For document_matches_recording and video_and_output_consistent: the SCREEN frames are SPARSE SAMPLES taken at evenly-spaced moments across the whole recording — they are NOT the entire recording, and most of the authoring activity happens BETWEEN the sampled frames. You will NOT see the full PDF text in any frame, and you should NOT expect to. Default to PASS unless there is positive evidence of fraud. Examine ALL screen frames as a set and look for ANY of: the document/editor/word processor/IDE/webpage/notes app open at any point; any text fragment, heading, code snippet, bullet, table, image, or layout element that resembles ANYTHING in the PDF; recognizable editor chrome (toolbars, ribbons, sidebars, tabs, cursor); progressive growth of content across frames. If ANY of these are present in ANY frame, pass with at least medium confidence — the absence of the full PDF text in the samples is expected and is NOT grounds for failure. Only FAIL if (a) zero frames show any editor or document-like surface at all, OR (b) the PDF contains substantial content that is visibly contradicted by the screen (e.g. frames clearly show a completely unrelated activity for the entire recording such as gaming, video watching, or an empty desktop). A frame showing the editor with partial or no content is evidence FOR authoring, not against it. Do not penalize for blank/transition frames, dark frames, or frames showing other windows briefly.
- For no_transcription_audio: you do NOT receive audio. Evaluate ONLY from visual cues — e.g. the user is clearly not interacting with a transcription UI, no transcription window is visible on screen. If nothing suspicious is visible, set passed=true with confidence "low" and reason "no audio analysis available; no visual indicators of transcription".
- For no_ai_generation_evidence: look for visible AI tools/chat windows/completions panes/“Generate with AI” buttons being used to author the document content. Spell-check or grammar suggestions are fine; ChatGPT/Claude/Copilot-style code or text generation being pasted in is not.
- Bias toward PASS for ambiguous cases. Only fail a check when there is concrete positive evidence of a problem; "I cannot see the content" is NOT evidence of a problem given the sparse sampling.
- Each "reason" must be ONE short sentence (max 200 chars) the end user will read.`;

    const userContent: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: `Project: "${data.projectName}" — recorded ${Math.round(
          data.durationSeconds / 60,
        )} min ${data.durationSeconds % 60} s.

Below are: SELFIE (1 image), then WEBCAM frames in chronological order, then SCREEN frames in chronological order, then PDF pages in order.`,
      },
      { type: "text", text: "SELFIE:" },
      { type: "image_url", image_url: { url: selfieDataUrl } },
      { type: "text", text: `WEBCAM frames (${data.webcamFrames.length}):` },
      ...data.webcamFrames.map((url) => ({
        type: "image_url",
        image_url: { url },
      })),
      { type: "text", text: `SCREEN frames (${data.screenFrames.length}):` },
      ...data.screenFrames.map((url) => ({
        type: "image_url",
        image_url: { url },
      })),
      { type: "text", text: `PDF pages (${data.pdfPageImages.length}):` },
      ...data.pdfPageImages.map((url) => ({
        type: "image_url",
        image_url: { url },
      })),
    ];

    const tool = {
      type: "function" as const,
      function: {
        name: "report_verification",
        description: "Report the verification verdict for all six checks.",
        parameters: {
          type: "object",
          properties: {
            checks: {
              type: "array",
              minItems: 6,
              maxItems: 6,
              items: {
                type: "object",
                properties: {
                  key: { type: "string", enum: [...CHECK_KEYS] },
                  passed: { type: "boolean" },
                  confidence: {
                    type: "string",
                    enum: ["low", "medium", "high"],
                  },
                  reason: { type: "string", maxLength: 240 },
                },
                required: ["key", "passed", "confidence", "reason"],
                additionalProperties: false,
              },
            },
            summary: { type: "string", maxLength: 400 },
          },
          required: ["checks", "summary"],
          additionalProperties: false,
        },
      },
    };

    const res = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          tools: [tool],
          tool_choice: {
            type: "function",
            function: { name: "report_verification" },
          },
        }),
      },
    );

    if (res.status === 429) {
      throw new Error(
        "Verification engine is rate-limited right now. Please try again in a minute.",
      );
    }
    if (res.status === 402) {
      throw new Error(
        "AI credits exhausted. Please add credits in workspace settings.",
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Verification engine failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const argsRaw =
      json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let parsed: { checks: Array<Omit<CheckResult, "label">>; summary: string };
    try {
      parsed = typeof argsRaw === "string" ? JSON.parse(argsRaw) : argsRaw;
    } catch {
      throw new Error("Verification engine returned an unparseable result.");
    }
    if (!parsed?.checks || !Array.isArray(parsed.checks)) {
      throw new Error("Verification engine returned no checks.");
    }

    // Normalize: ensure all six checks present, attach labels.
    const byKey = new Map(parsed.checks.map((c) => [c.key as CheckKey, c]));
    const checks: CheckResult[] = CHECK_KEYS.map((k) => {
      const found = byKey.get(k);
      return {
        key: k,
        label: LABELS[k],
        passed: Boolean(found?.passed),
        confidence: (found?.confidence ?? "low") as CheckResult["confidence"],
        reason: found?.reason ?? "No assessment returned for this check.",
      };
    });

    const allPassed = checks.every((c) => c.passed);
    const status = allPassed ? "verified" : "rejected";

    // Only persist verdict if a certificate row already exists. In the new
    // flow we verify BEFORE issuing the certificate, so on a failed verdict
    // there's nothing to update — the cert is never created.
    if (data.certificateId) {
      const notes = {
        checks: checks.map((c) => ({ ...c })),
        summary: parsed.summary ?? "",
      } as unknown as Record<string, unknown>;
      const { error: updErr } = await supabase
        .from("certificates")
        .update({
          verification_status: status,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          verification_notes: notes as any,
        })
        .eq("certificate_id", data.certificateId)
        .eq("user_id", userId);
      if (updErr) throw new Error(updErr.message);
    }

    return {
      passed: allPassed,
      status,
      summary: parsed.summary ?? "",
      checks,
    };
  });

function btoaBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  // btoa is available in the Worker runtime.
  return btoa(s);
}
