## Diagnosis

`CERT-HY6N-JZ` shows the same pattern: Gemini failed the screen/document checks with “no authoring application,” but the appeal was manually reversed and issued. One important detail: this was a **17-second recording**, so the current 24-frame sparse sampler may still miss very short typing/document transitions or show frames that are too downscaled for Gemini to identify the authoring surface reliably.

## Plan

1. **Replace sparse frame-only review with a richer evidence packet**
   - Add deterministic timestamps that always include: first frame, early progress, midpoint, late progress, and the final frame.
   - For short recordings, sample more densely across the whole video instead of only “end-weighted” frames.
   - Increase screen-frame detail enough for Word/Google Docs/editor UI and typed text to be readable.

2. **Add visual timeline/context frames for Gemini**
   - Include a small set of “difference/progress” frames or adjacent timestamp clusters so Gemini can see whether document content changes over time rather than treating frames independently.
   - Label frames as `SCREEN START`, `SCREEN PROGRESS`, `SCREEN FINAL`, etc., not just timestamps.

3. **Make rejection rules conservative in code, not only in the prompt**
   - After Gemini returns checks, add a server-side guardrail: if the two screen-authorship checks fail only because “no authoring app / not shown / impossible to confirm,” downgrade those failures to pass-low-confidence unless Gemini provides concrete contradictory evidence.
   - Keep strict failures for actual contradiction, blank/unrelated final document, AI-generation evidence, person mismatch, other people, or transcription concerns.

4. **Persist debugging evidence**
   - Store the new `screenEvidence` summary when certificates are issued and when appeals are submitted/reversed so future examples show whether Gemini focused on the wrong surface.
   - Preserve the public six checks unchanged.

5. **Adjust final certificate/appeal data flow**
   - Pass `screenEvidence` through `createCertificate`, appeal submission, and manual reversal so the metadata is not lost after issuing/reversing a certificate.

## Files to update

- `src/lib/media-sampling.ts` — denser short-recording sampling and clearer timestamp/frame labeling support.
- `src/routes/_authenticated.record.tsx` — use the improved sampler and pass `screenEvidence` through certificate/appeal flows.
- `src/lib/verification.functions.ts` — stricter prompt wording plus server-side false-positive guardrail.
- `src/lib/certificates.functions.ts` — accept and store optional `screenEvidence`.
- `src/lib/appeals.functions.ts` — accept/store/pass optional `screenEvidence` through appeal review and reversal.
- `src/routes/appeals.$token.tsx` — display screen-evidence notes for reviewer debugging.