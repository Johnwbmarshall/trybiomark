Root cause found: the app starts the actual MediaRecorder before the pre-flight checklist. In `src/routes/_authenticated.record.tsx`, `handleStart()` calls `recorder.start()` and then shows the checklist. In `src/hooks/useMediaRecorder.ts`, that `start()` immediately starts both screen/webcam recorders and the timer. So if the checklist takes most of the session, the saved recording and the 24 evenly spaced verification frames are dominated by setup/checklist screens. CERT-SPHZ-FV matches this pattern: a 272-second recording, rejected for setup-screen dominance, then later manually reversed on appeal.

Plan:

1. Split “media setup” from “actual recording”
   - Refactor `useMediaRecorder` so the permission/screen/webcam capture step only prepares live preview streams for the checklist.
   - Do not create/start `MediaRecorder` instances or start elapsed timing during pre-flight.
   - Add a separate method, e.g. `beginRecording()`, that starts screen/webcam recording only after the checklist passes.

2. Update the record page flow
   - Keep `Start Session` as the permission + monitor-sharing + checklist entry point.
   - Change the pre-flight `Begin recording` button to call the new `beginRecording()` method before switching to the live recording phase.
   - Keep checklist cancel behavior stopping all prepared streams.
   - Keep stop/upload/finalize behavior the same, but now the blobs contain only the live authoring portion.

3. Improve verification resilience for short/end-heavy sessions
   - Adjust frame sampling so it still samples across the recording, but includes stronger coverage near the end of the actual recording where final edits commonly appear.
   - Keep the Gemini prompt’s “sparse samples” guidance, but make the submitted evidence less likely to miss late authoring activity.

4. Validate the fix
   - Confirm the checklist still shows webcam, screen preview, mic level, and troubleshooting info.
   - Confirm elapsed time starts at 0 only after the checklist is approved.
   - Confirm stopped recordings no longer include pre-flight setup time, so Gemini evaluates the actual work session instead of setup screens.