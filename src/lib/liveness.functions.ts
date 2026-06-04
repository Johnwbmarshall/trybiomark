import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHmac, randomBytes } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ----- Shared constants -----

export const POSE_PROMPTS = [
  "Look LEFT",
  "Look RIGHT",
  "Look UP",
  "Look DOWN",
  "Tilt your head LEFT",
  "Tilt your head RIGHT",
  "Open your mouth wide",
  "Raise your LEFT hand",
  "Raise your RIGHT hand",
  "Show a thumbs up",
] as const;

// Vivid, distinctive flash colors. Picked so the average tint difference
// is easy to detect in a webcam frame.
export const FLASH_COLORS = [
  { hex: "#FF2D55", name: "vivid red-pink" },
  { hex: "#22C55E", name: "bright green" },
  { hex: "#3B82F6", name: "strong blue" },
  { hex: "#F59E0B", name: "warm orange-amber" },
  { hex: "#A855F7", name: "vivid purple" },
  { hex: "#06B6D4", name: "bright cyan" },
] as const;

export type LivenessChallenge = {
  challengeId: string;
  nonce: string;
  pose: string;
  flashHex: string;
  flashName: string;
  issuedAt: number; // ms epoch
  expiresAt: number; // ms epoch
  hmac: string;
};

export type LivenessReceipt = {
  challengeId: string;
  nonce: string;
  pose: string;
  flashHex: string;
  flashName: string;
  issuedAt: number;
  verifiedAt: number;
  ok: boolean;
  reason: string;
  hmac: string;
};

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function signingSecret(): string {
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.LOVABLE_API_KEY ??
    "bio-mark-dev-fallback-secret";
  return `liveness-v1:${key}`;
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("hex");
}

function challengePayload(c: {
  challengeId: string;
  nonce: string;
  pose: string;
  flashHex: string;
  issuedAt: number;
  expiresAt: number;
  userId: string;
}): string {
  return [
    "challenge",
    c.challengeId,
    c.nonce,
    c.pose,
    c.flashHex,
    c.issuedAt,
    c.expiresAt,
    c.userId,
  ].join("|");
}

function receiptPayload(r: {
  challengeId: string;
  nonce: string;
  pose: string;
  flashHex: string;
  issuedAt: number;
  verifiedAt: number;
  ok: boolean;
  userId: string;
}): string {
  return [
    "receipt",
    r.challengeId,
    r.nonce,
    r.pose,
    r.flashHex,
    r.issuedAt,
    r.verifiedAt,
    r.ok ? "1" : "0",
    r.userId,
  ].join("|");
}

function randomNonce(): string {
  // 4 character base32-ish nonce; uppercase only, unambiguous chars.
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = randomBytes(4);
  let s = "";
  for (let i = 0; i < 4; i++) s += ALPHA[buf[i] % ALPHA.length];
  return `BIO-${s}`;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ----- Issue a fresh challenge -----

export const issueLivenessChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LivenessChallenge> => {
    const { userId } = context;
    const issuedAt = Date.now();
    const expiresAt = issuedAt + CHALLENGE_TTL_MS;
    const challengeId = randomBytes(8).toString("hex");
    const nonce = randomNonce();
    const pose = pick(POSE_PROMPTS);
    const color = pick(FLASH_COLORS);

    const hmac = sign(
      challengePayload({
        challengeId,
        nonce,
        pose,
        flashHex: color.hex,
        issuedAt,
        expiresAt,
        userId,
      }),
    );

    return {
      challengeId,
      nonce,
      pose,
      flashHex: color.hex,
      flashName: color.name,
      issuedAt,
      expiresAt,
      hmac,
    };
  });

// ----- Submit a captured webcam frame; ask Gemini to verify; issue a receipt -----

const dataUrl = z
  .string()
  .min(50)
  .max(2_500_000)
  .regex(/^data:image\/(jpeg|png|webp);base64,/);

const submitSchema = z.object({
  challenge: z.object({
    challengeId: z.string().min(8).max(64),
    nonce: z.string().min(4).max(32),
    pose: z.string().min(1).max(64),
    flashHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    flashName: z.string().min(1).max(64),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
    hmac: z.string().min(16).max(128),
  }),
  webcamFrameDataUrl: dataUrl,
});

export const submitLivenessChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => submitSchema.parse(input))
  .handler(async ({ data, context }): Promise<LivenessReceipt> => {
    const { userId } = context;
    const c = data.challenge;

    // 1. Re-verify HMAC of the issued challenge.
    const expected = sign(
      challengePayload({
        challengeId: c.challengeId,
        nonce: c.nonce,
        pose: c.pose,
        flashHex: c.flashHex,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        userId,
      }),
    );
    if (expected !== c.hmac) {
      throw new Error("Invalid liveness challenge signature.");
    }
    if (Date.now() > c.expiresAt) {
      throw new Error("Liveness challenge expired — please retry.");
    }

    // 2. Ask Gemini to confirm pose + colour tint in the webcam frame.
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const res = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                "You inspect a single webcam still captured during a liveness challenge. The user was asked to perform a specific pose while their screen flashed a specific colour. Report whether the pose is being performed AND whether the captured frame shows a clear tint of the requested colour cast onto the subject (skin/clothes/wall, NOT only on a screen behind them).",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Requested pose: "${c.pose}"\nRequested colour cast: ${c.flashName} (${c.flashHex})\n\nReport via the report_liveness tool.`,
                },
                { type: "image_url", image_url: { url: data.webcamFrameDataUrl } },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "report_liveness",
                description: "Report whether the liveness challenge was satisfied.",
                parameters: {
                  type: "object",
                  properties: {
                    posePassed: { type: "boolean" },
                    colorPassed: { type: "boolean" },
                    reason: { type: "string", maxLength: 220 },
                  },
                  required: ["posePassed", "colorPassed", "reason"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "report_liveness" },
          },
        }),
      },
    );

    if (res.status === 429)
      throw new Error("Liveness check rate-limited. Please retry shortly.");
    if (res.status === 402)
      throw new Error("AI credits exhausted. Please add credits in workspace settings.");
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Liveness verification failed (${res.status}): ${t.slice(0, 200)}`);
    }

    const json = await res.json();
    const argsRaw = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let parsed: { posePassed: boolean; colorPassed: boolean; reason: string };
    try {
      parsed = typeof argsRaw === "string" ? JSON.parse(argsRaw) : argsRaw;
    } catch {
      throw new Error("Liveness verifier returned an unparseable result.");
    }

    const ok = Boolean(parsed?.posePassed) && Boolean(parsed?.colorPassed);
    const reason = parsed?.reason ?? "";
    const verifiedAt = Date.now();

    const hmac = sign(
      receiptPayload({
        challengeId: c.challengeId,
        nonce: c.nonce,
        pose: c.pose,
        flashHex: c.flashHex,
        issuedAt: c.issuedAt,
        verifiedAt,
        ok,
        userId,
      }),
    );

    return {
      challengeId: c.challengeId,
      nonce: c.nonce,
      pose: c.pose,
      flashHex: c.flashHex,
      flashName: c.flashName,
      issuedAt: c.issuedAt,
      verifiedAt,
      ok,
      reason,
      hmac,
    };
  });

// ----- Server-side helper used by verifySubmission to validate a receipt -----

export function verifyReceiptSignature(
  r: LivenessReceipt,
  userId: string,
): boolean {
  const expected = sign(
    receiptPayload({
      challengeId: r.challengeId,
      nonce: r.nonce,
      pose: r.pose,
      flashHex: r.flashHex,
      issuedAt: r.issuedAt,
      verifiedAt: r.verifiedAt,
      ok: r.ok,
      userId,
    }),
  );
  return expected === r.hmac;
}
