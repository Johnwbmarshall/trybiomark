// Server-only helpers for liveness challenges. The `.server.ts` extension
// forbids any client-side import; liveness.functions.ts must only reference
// this module from inside `.handler()` bodies via `await import(...)`.
import { createHmac, randomBytes } from "crypto";

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

export const FLASH_COLORS = [
  { hex: "#FF2D55", name: "vivid red-pink" },
  { hex: "#22C55E", name: "bright green" },
  { hex: "#3B82F6", name: "strong blue" },
  { hex: "#F59E0B", name: "warm orange-amber" },
  { hex: "#A855F7", name: "vivid purple" },
  { hex: "#06B6D4", name: "bright cyan" },
] as const;

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type LivenessReceiptForVerify = {
  challengeId: string;
  nonce: string;
  pose: string;
  flashHex: string;
  issuedAt: number;
  verifiedAt: number;
  ok: boolean;
  hmac: string;
};

function signingSecret(): string {
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.LOVABLE_API_KEY ??
    "bio-mark-dev-fallback-secret";
  return `liveness-v1:${key}`;
}

export function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("hex");
}

export function challengePayload(c: {
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

export function receiptPayload(r: {
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

export function randomNonce(): string {
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = randomBytes(4);
  let s = "";
  for (let i = 0; i < 4; i++) s += ALPHA[buf[i] % ALPHA.length];
  return `BIO-${s}`;
}

export function randomChallengeId(): string {
  return randomBytes(8).toString("hex");
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function verifyReceiptSignature(
  r: LivenessReceiptForVerify,
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
