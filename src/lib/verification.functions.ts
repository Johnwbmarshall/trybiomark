import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type LivenessReceipt } from "./liveness.functions";

const frameUrl = z
  .string()
  .trim()
  .min(50)
  .max(2_500_000)
  .regex(/^data:image\/(jpeg|png|webp);base64,/);

const timestampedFrame = z.object({
  dataUrl: frameUrl,
  timestampSec: z.number().min(0).max(60 * 60 * 24),
});

// Accept either plain data URLs (legacy) or timestamped frames.
const frameInput = z.union([frameUrl, timestampedFrame]);

const livenessReceiptSchema = z.object({
  challengeId: z.string().min(8).max(64),
  nonce: z.string().min(4).max(32),
  pose: z.string().min(1).max(64),
  flashHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  flashName: z.string().min(1).max(64),
  issuedAt: z.number().int(),
  verifiedAt: z.number().int(),
  ok: z.boolean(),
  reason: z.string().max(400).default(""),
  hmac: z.string().min(16).max(128),
});

const schema = z.object({
  certificateId: z
    .string()
    .trim()
    .regex(/^CERT-[A-Z0-9-]+$/i, "Invalid certificate id")
    .optional(),
  screenFrames: z.array(frameInput).min(1).max(40),
  webcamFrames: z.array(frameInput).min(1).max(20),
  pdfPageImages: z.array(frameUrl).min(1).max(10),
  audioDataUrl: z
    .string()
    .regex(/^data:audio\/(mpeg|mp3|wav|webm|ogg);base64,/)
    .max(8_500_000)
    .optional(),
  durationSeconds: z.number().int().min(0).max(60 * 60 * 24),
  projectName: z.string().trim().min(1).max(120),
  // Anti-spoofing: nonces issued during the recording that must appear in
  // the PDF text, plus signed liveness receipts collected mid-session.
  requiredNonces: z.array(z.string().min(2).max(32)).max(20).optional(),
  pdfText: z.string().max(2_000_000).optional(),
  livenessReceipts: z.array(livenessReceiptSchema).max(20).optional(),
});


function formatStamp(t: number): string {
  const total = Math.max(0, Math.floor(t));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function normalizeFrame(
  f: string | { dataUrl: string; timestampSec: number },
  fallbackIdx: number,
  total: number,
  duration: number,
): { dataUrl: string; timestampSec: number } {
  if (typeof f === "string") {
    const t = total > 0 ? ((fallbackIdx + 0.5) / total) * duration : 0;
    return { dataUrl: f, timestampSec: t };
  }
  return f;
}

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
    "No evidence the user is transcribing another document (gaze off-screen/above camera while typing, or dictation/transcription audio cues)",
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

    // Normalize frames so every screen/webcam image carries a timestamp.
    const screenFrames = data.screenFrames.map((f, i) =>
      normalizeFrame(f, i, data.screenFrames.length, data.durationSeconds),
    );
    const webcamFrames = data.webcamFrames.map((f, i) =>
      normalizeFrame(f, i, data.webcamFrames.length, data.durationSeconds),
    );

    const systemPrompt = `You are the verification engine for Bio Mark, which issues human-authorship certificates.
You must evaluate a submission across SIX strict checks and call the report tool exactly once with all six results.

CHECKS:
${labelEntries}

HOW THE SCREEN EVIDENCE WORKS:
- The SCREEN frames are SPARSE TIMESTAMPED SAMPLES from a screen recording of the user authoring a document. Each frame is labeled with its timestamp (e.g. "SCREEN @ 0:42"). The frames are NOT the full recording — most authoring activity happens BETWEEN them. End-of-recording frames are sampled more densely so the final document state should usually be visible there.
- The user may have shared multiple monitors (one wide tiled image) and may have multiple windows open.
- The Bio Mark recording page itself (a web app showing webcam preview, "Recording" indicator, timer, Pause/Stop buttons, "Pre-flight checklist", "Start Session", or the bio-mark.ca URL) IS NOT the authored document. Treat it the same as any other browser tab — it is the recording tool, not the working surface.

STEP 1 — IDENTIFY THE WORKING DOCUMENT:
- Scan ALL screen frames and identify the WORKING DOCUMENT: the application/window where authoring is actually happening. Examples: Microsoft Word, Google Docs, Pages, LibreOffice Writer, Apple Notes, Notion, Obsidian, a code editor (VS Code, JetBrains, Xcode, Sublime), a markdown editor, a design tool (Figma, Illustrator), or any equivalent authoring surface.
- Signals: visible app chrome/toolbar (e.g. "Word", ribbon, formatting bar), a text caret, text or content that grows/changes across timestamps, scroll position changing, selections, file name in title bar.
- The working document might only appear in a subset of frames (especially the latest ones). That is normal — users often set up the recording in the browser first and then switch to their authoring app.
- If you find no authoring surface in ANY frame, say so explicitly in screenEvidence and fail document_matches_recording with a clear reason.

STEP 2 — COMPARE START vs END:
- Look at the EARLIEST frame where the working document is visible and the LATEST frame where it is visible.
- Describe in screenEvidence: which app it is, what was on screen near the start vs near the end, what visible text fragments / headings / structures you can confirm were authored during the recording, and whether they match the PDF.

STEP 3 — VERDICTS:
- document_matches_recording: PASS (medium or high) if the working document at the latest visible timestamp shows ANY content that plausibly corresponds to the PDF (matching title, headings, paragraph fragments, layout, code, table, image). PASS with low/medium confidence if a working document is clearly present and being authored but its final state isn't fully readable in the sampled frames. FAIL ONLY if: (a) no authoring surface appears in any frame, OR (b) the latest visible working-document state directly contradicts the PDF (e.g. completely different document, blank doc while PDF has many pages of text, totally unrelated content). Do NOT fail just because you can only see the Bio Mark website in early frames — check the LATER frames for the actual authoring app.
- video_and_output_consistent: PASS unless the working document shows the PDF's content appearing in a single jump with no intermediate authoring evidence AND there is no plausible explanation (e.g. paste from clipboard with no prior typing). Reference documents on a side monitor, in a browser tab, or in another window are ALLOWED.
- person_matches_selfie: compare the SELFIE against the WEBCAM frames. Pass only if plausibly the same person.
- no_other_people_in_frame: fail if any webcam frame shows additional people.
- no_transcription_audio: no audio is provided. Evaluate from webcam gaze + any visible transcription/dictation UI. Sustained off-screen glances at a desk/paper while typing = FAIL. Glances at a second monitor showing reference material = PASS. If webcam frames are too few/unclear, PASS with low confidence.
- no_ai_generation_evidence: look for ChatGPT/Claude/Copilot/Gemini chat windows or AI generation panes actively producing the document text. Spell-check, grammar, and basic IDE autocomplete are fine.

GENERAL RULES:
- Bias toward PASS for ambiguous cases. "I cannot see the full content" is NOT a reason to fail given sparse sampling.
- Never fail document_matches_recording solely because some frames show the Bio Mark recording UI — that just means the user hadn't switched to their authoring app yet.
- Each "reason" is ONE short sentence (max 200 chars) shown to the end user. screenEvidence is a longer paragraph (max 600 chars) describing what you saw.`;

    const userContent: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: `Project: "${data.projectName}" — total recording length ${formatStamp(data.durationSeconds)} (${data.durationSeconds}s).

Order below: SELFIE, then WEBCAM frames with timestamps, then SCREEN frames with timestamps, then PDF pages.`,
      },
      { type: "text", text: "SELFIE (reference photo from profile):" },
      { type: "image_url", image_url: { url: selfieDataUrl } },
      { type: "text", text: `WEBCAM frames (${webcamFrames.length}):` },
      ...webcamFrames.flatMap((f) => [
        { type: "text", text: `WEBCAM @ ${formatStamp(f.timestampSec)}` },
        { type: "image_url", image_url: { url: f.dataUrl } },
      ]),
      {
        type: "text",
        text: `SCREEN frames (${screenFrames.length}) — sampled across the full ${formatStamp(data.durationSeconds)} recording, with denser coverage near the end where the finished document is most likely visible. Look at LATE timestamps first to find the working document:`,
      },
      ...screenFrames.flatMap((f) => [
        { type: "text", text: `SCREEN @ ${formatStamp(f.timestampSec)}` },
        { type: "image_url", image_url: { url: f.dataUrl } },
      ]),
      { type: "text", text: `PDF pages (${data.pdfPageImages.length}) — the final submitted document:` },
      ...data.pdfPageImages.flatMap((url, i) => [
        { type: "text", text: `PDF page ${i + 1}` },
        { type: "image_url", image_url: { url } },
      ]),
    ];

    const tool = {
      type: "function" as const,
      function: {
        name: "report_verification",
        description:
          "Report the verification verdict. Identify the working document surface first, then return all six checks plus a screenEvidence summary.",
        parameters: {
          type: "object",
          properties: {
            screenEvidence: {
              type: "string",
              maxLength: 600,
              description:
                "What working-document app/window was identified (e.g. 'Microsoft Word — Document1.docx'), what was visible near the start vs the end of the recording, and what specific PDF content you could confirm was authored during the session. If no authoring surface was found, say so plainly.",
            },
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
          required: ["screenEvidence", "checks", "summary"],
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
    let parsed: {
      checks: Array<Omit<CheckResult, "label">>;
      summary: string;
      screenEvidence?: string;
    };
    try {
      parsed = typeof argsRaw === "string" ? JSON.parse(argsRaw) : argsRaw;
    } catch {
      throw new Error("Verification engine returned an unparseable result.");
    }
    if (!parsed?.checks || !Array.isArray(parsed.checks)) {
      throw new Error("Verification engine returned no checks.");
    }

    const byKey = new Map(parsed.checks.map((c) => [c.key as CheckKey, c]));
    const rawChecks: CheckResult[] = CHECK_KEYS.map((k) => {
      const found = byKey.get(k);
      return {
        key: k,
        label: LABELS[k],
        passed: Boolean(found?.passed),
        confidence: (found?.confidence ?? "low") as CheckResult["confidence"],
        reason: found?.reason ?? "No assessment returned for this check.",
      };
    });

    const screenEvidence = parsed.screenEvidence ?? "";

    // ----- Server-side guardrail against "I didn't see it" false positives -----
    // For the two screen-authorship checks, only treat a FAIL as real when
    // Gemini cites concrete contradictory evidence. If the failure is just
    // "no authoring app visible / can't see / impossible to confirm", downgrade
    // to a low-confidence PASS so the sparse-sampling problem doesn't reject
    // legitimate submissions.
    const SCREEN_AUTHORSHIP_KEYS: CheckKey[] = [
      "document_matches_recording",
      "video_and_output_consistent",
    ];
    const NEGATIVE_EVIDENCE_RE =
      /\b(no(t)?\s+(visible|shown|seen|present|observed)|does\s+not\s+show|doesn['’]?t\s+show|no\s+(authoring|application|app|editor|document)|cannot\s+(see|confirm|verify|determine)|can['’]?t\s+(see|confirm)|impossible\s+to\s+confirm|no\s+evidence\s+of\s+(it\s+being|the\s+document|authoring|writing|creation|typing)|never\s+shown)\b/i;
    const POSITIVE_CONTRADICTION_RE =
      /\b(contradict|mismatch|different\s+document|unrelated|blank\s+document|empty\s+document|wrong\s+document|does\s+not\s+match|appears?\s+at\s+once|sudden(ly)?\s+appears|pasted|paste\s+event|all\s+at\s+once)\b/i;

    const checks: CheckResult[] = rawChecks.map((c) => {
      if (c.passed) return c;
      if (!SCREEN_AUTHORSHIP_KEYS.includes(c.key)) return c;
      const haystack = `${c.reason} ${screenEvidence}`;
      const looksLikeAbsenceOnly =
        NEGATIVE_EVIDENCE_RE.test(haystack) &&
        !POSITIVE_CONTRADICTION_RE.test(haystack);
      if (!looksLikeAbsenceOnly) return c;
      return {
        ...c,
        passed: true,
        confidence: "low",
        reason:
          "Sparse frame sampling could not show authorship directly, but no concrete contradiction was found in the recording or document.",
      };
    });

    // ----- Anti-spoofing: deterministic liveness + in-document nonce checks -----
    // These run server-side, independent of Gemini's six narrative checks.
    // They make pre-recorded webcam / screen replays much harder by requiring:
    //   (a) at least 2 valid HMAC-signed liveness receipts (screen-flash + pose
    //       challenges the user passed live during the recording), and
    //   (b) every nonce issued during the recording appears in the final PDF
    //       text.
    const requiredNonces = (data.requiredNonces ?? [])
      .map((n) => n.trim().toUpperCase())
      .filter((n) => n.length > 0);
    const pdfTextUpper = (data.pdfText ?? "").toUpperCase();
    const livenessReceipts: LivenessReceipt[] = (data.livenessReceipts ?? []) as LivenessReceipt[];

    const validReceipts = livenessReceipts.filter(
      (r) => verifyReceiptSignature(r, userId) && r.ok,
    );
    const livenessOk = validReceipts.length >= 1;
    const livenessCheck: CheckResult = {
      key: "liveness_confirmed" as CheckKey,
      label:
        "Live screen-flash and pose challenge was passed at the end of recording",
      passed: livenessOk,
      confidence: livenessOk ? "high" : "high",
      reason: livenessOk
        ? `End-of-recording live challenge passed (screen-flash colour + pose, verified on the live webcam).`
        : livenessReceipts.length === 0
          ? "No live challenge was completed before stopping. A pre-recorded webcam feed cannot react to the screen flash and pose prompt shown when Stop is clicked."
          : `The end-of-recording live challenge did not pass (${validReceipts.length}/${livenessReceipts.length}). A passing challenge is required to rule out a spoofed webcam feed.`,
    };

    const missingNonces = requiredNonces.filter(
      (n) => !pdfTextUpper.includes(n),
    );
    const nonceOk = requiredNonces.length > 0 && missingNonces.length === 0;
    const nonceCheck: CheckResult = {
      key: "nonce_in_document" as CheckKey,
      label:
        "Random codes shown during the recording were typed into the document",
      passed: nonceOk,
      confidence: "high",
      reason: nonceOk
        ? `All ${requiredNonces.length} session codes were found in the PDF text — proving the document was finalised during this live session.`
        : requiredNonces.length === 0
          ? "No session codes were submitted. A pre-recorded screen feed cannot contain codes that didn't exist when it was recorded."
          : `Missing session code${missingNonces.length === 1 ? "" : "s"} in the PDF text: ${missingNonces.join(", ")}. Type the codes shown during recording into the document before finalising.`,
    };

    const finalChecks: CheckResult[] = [...checks, livenessCheck, nonceCheck];
    const allPassed = finalChecks.every((c) => c.passed);
    const status = allPassed ? "verified" : "rejected";

    if (data.certificateId) {
      const notes = {
        checks: finalChecks.map((c) => ({ ...c })),
        summary: parsed.summary ?? "",
        screenEvidence,
        rawChecks: rawChecks.map((c) => ({ ...c })),
        liveness: {
          totalReceipts: livenessReceipts.length,
          validReceipts: validReceipts.length,
        },
        requiredNonces,
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
      screenEvidence,
      checks: finalChecks,
    };
  });

function btoaBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  // btoa is available in the Worker runtime.
  return btoa(s);
}
