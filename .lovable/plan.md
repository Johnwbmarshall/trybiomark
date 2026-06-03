## Plan

1. **Fix what Gemini is actually shown**
   - Replace the current 24 evenly-spaced screen screenshots with a timestamped evidence packet.
   - Include exact early, middle, and final frames, with extra dense coverage near the end of the recording where final document state often appears.
   - Label each image with its timestamp so Gemini can compare document start, progress, and finish instead of treating frames as unlabeled screenshots.

2. **Make screen evidence app/document focused**
   - Update the verification prompt so Gemini must first identify the working document surface: Microsoft Word, Google Docs, Pages, LibreOffice, a text editor, IDE, notes app, or equivalent authoring program.
   - Require it to describe:
     - which app/window is the working document,
     - what the document looked like near the start,
     - what it looked like near the end,
     - what visible text/layout fragments it can confirm were created,
     - whether any PDF content is actually contradicted by the recording.
   - Explicitly tell Gemini that Bio Mark’s recording page, preview window, browser chrome, and setup UI are not the authored document unless no other authoring surface exists.

3. **Change failure criteria to avoid “I didn’t see everything” false positives**
   - For “PDF matches what was created on screen” and “video/output consistent,” fail only when Gemini can point to concrete positive evidence:
     - no authoring app/document surface appears in any relevant screen frame, or
     - the final PDF is visibly contradicted by the working document state, or
     - text/layout appears all at once with no plausible creation/progress evidence.
   - Passing should be allowed when the recording confirms partial authorship: visible Word/equivalent app, typed fragments, growing content, cursor movement, final document state, or matching PDF fragments.

4. **Add structured reasoning fields to verification output**
   - Extend Gemini’s tool schema to return a short `screenEvidence` summary alongside the six checks.
   - Store that summary in verification notes so future appeals/debugging can show whether Gemini identified the correct working document or incorrectly focused on the Bio Mark page.

5. **Keep compatibility with existing certificates and appeals**
   - Keep the six existing public checks unchanged for user-facing certificate display.
   - Add the extra screen-evidence summary as optional metadata only, so existing records still render normally.

## Technical details

- Update `src/lib/media-sampling.ts` to support timestamped video frame extraction and end-weighted sampling.
- Update `src/routes/_authenticated.record.tsx` to submit timestamped screen/webcam evidence to verification instead of anonymous image arrays.
- Update `src/lib/verification.functions.ts` schema, prompt, user message construction, and tool schema to use timestamp labels and require working-document analysis before verdicts.
- Keep PDF page extraction as-is, but label PDF pages clearly in the multimodal prompt.

## Expected result

Gemini should stop rejecting sessions merely because it sees Bio Mark UI in some frames. It will be guided to locate Word or an equivalent authoring surface, compare early/progress/final states, and only reject when there is concrete evidence the submitted PDF was not authored in the recording.