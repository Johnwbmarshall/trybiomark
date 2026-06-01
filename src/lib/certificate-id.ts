// Generate a public certificate id of the form CERT-XXXX-XX
// Uses crypto.getRandomValues for cryptographic randomness.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // omit ambiguous chars

export function generateCertificateId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `CERT-${chars.slice(0, 4).join("")}-${chars.slice(4, 6).join("")}`;
}
