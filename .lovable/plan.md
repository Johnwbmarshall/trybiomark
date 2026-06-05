## Goal

Stop interrupting the user while they write. Replace the mid-session liveness scheduler with **one** liveness challenge that runs at the moment the user clicks **Stop** — the recording cannot be finalized until that single challenge passes.

The in-document nonce (typed-code-in-PDF) stays as-is; only the webcam/screen-flash liveness UX changes.

## Changes

### 1. `src/routes/_authenticated.record.tsx`
- Remove the random-interval scheduler (`livenessTimerRef`, the 20–40s timeout, and the recurring 45–90s re-arm). Delete the `useEffect` that schedules mid-session challenges.
- Keep the **opening nonce** issuance on record start (so the user still has a code to type into their document during the session) — this is silent, no overlay.
- Rework `handleStop` into a two-phase flow:
  1. **Pause** the MediaRecorder (do not stop yet) and keep the webcam stream live.
  2. Call `runLivenessChallenge()` — issues challenge, shows `LivenessOverlay`, snaps webcam frame, submits, stores receipt.
  3. On pass → resume briefly to flush, then actually stop and proceed to upload/verify.
  4. On fail → show inline error, allow the user to **Retry liveness** (re-issue) up to N times (e.g. 3). If they exhaust retries, surface "Liveness failed — recording cannot be submitted" with an option to discard.
- Disable the Stop button while the end-of-recording challenge is in flight so it can't be double-triggered.
- Remove the persistent "Liveness checks passed: X" status line; replace with a single "Liveness: pending / passed / failed" indicator near Stop.

### 2. `src/components/RecordingControls.tsx` (light touch)
- Add a `stopPending` / `stopLabel` prop so the Stop button can render "Finishing… hold pose" while the end challenge runs.

### 3. `src/lib/verification.functions.ts`
- Lower the required-receipt threshold from `>= 2` to `>= 1` in the `livenessCheck` block (since we now only run one challenge). Update the reason strings accordingly ("1 live challenge passed at end of recording").
- No schema changes; `livenessReceipts` array continues to accept 0–20 entries.

### 4. `LivenessOverlay`
- No structural change. Optionally bump `durationMs` slightly (e.g. 2600ms) so the end-of-session pose is easier to hit on the first try.

## Anti-spoof posture after this change

- A pre-recorded webcam feed still cannot pass the end-of-session challenge (random pose + random screen-flash colour issued server-side at click time).
- A pre-recorded screen feed still cannot contain the opening nonce that was issued at record-start for this session — it must appear in the final PDF.
- Net effect: one live interaction required, at a moment the user is already stopping to review → minimal disruption, same spoof resistance against pure replay attacks. A live human-in-the-loop attacker is still required to defeat it (unchanged from the previous design).

## Out of scope

- No change to nonce generation, PDF text extraction, or the Gemini prompt.
- No DB / migration changes.
