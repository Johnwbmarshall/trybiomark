
# ProofOfHuman — Build Plan

A small note on stack: this project runs on **TanStack Start** (not Next.js). The plan keeps your exact features and UX but uses TanStack routes + server functions where you wrote Next.js. The Recorder, Supabase, PDF, and `/verify` flows are unchanged.

---

## Phase 1 — Front-end Recorder

Route: `src/routes/record.tsx` (protected, under `_authenticated`)

- `useMediaRecorder` hook wrapping the browser `MediaRecorder` API
- Single **Start Session** button that requests:
  - `getDisplayMedia({ video: true, audio: true })` — screen + system audio
  - `getUserMedia({ video: true, audio: true })` — webcam + mic
- Live preview: screen feed large, webcam in a floating PiP card
- Recording HUD: elapsed time, pulsing red dot, **Stop Recording** button
- Two parallel `MediaRecorder` instances (screen + webcam) producing two `webm` blobs, muxed client-side into a single payload object
- Input for **Project Name** captured before recording starts

## Phase 2 — Auth + Database (Lovable Cloud)

Enable Lovable Cloud (Supabase under the hood). Email/password + Google sign-in.

Tables:

```text
certificates
  id              uuid pk
  certificate_id  text unique         -- "CERT-XXXX-XX" public id
  user_id         uuid → auth.users
  project_name    text
  created_at      timestamptz
  screen_video_url   text             -- private storage path
  webcam_video_url   text             -- private storage path
  verification_status text             -- 'verified' | 'pending'
  duration_seconds  int
```

Storage bucket: `recordings` (private). RLS on `certificates`:
- Owner can SELECT/INSERT their own rows
- Anonymous can SELECT a **safe view** (`public_certificates`) exposing only `certificate_id`, `project_name`, `created_at`, `verification_status` — never video URLs

Auth gate: `/record` and `/dashboard` live under `_authenticated`. `/`, `/login`, `/verify`, `/verify/$id` are public.

## Phase 3 — Upload + Certificate PDF

On **Stop Recording**:
1. Finalize the two blobs
2. Upload both to `recordings/{user_id}/{certificate_id}/` via the browser Supabase client (RLS lets users write only to their own prefix)
3. Call `createCertificate` server function (`createServerFn` + `requireSupabaseAuth`) that:
   - Generates a cryptographic ID: `CERT-` + 8 hex from `crypto.randomUUID()` formatted `XXXX-XX`
   - Inserts the `certificates` row
   - Returns `{ certificateId, downloadUrl }`
4. Client renders a **success screen** with:
   - The certificate ID (copyable)
   - A **Download Certificate (PDF)** button generated client-side via `jspdf` — shows project name, ID, date, owner, and the public `/verify/{id}` URL with a QR code (`qrcode` lib)

Note on "compression": browser-side video compression of a long recording is heavy and slow. The plan uploads the native `webm` blobs (already VP9/Opus, well-compressed). If true re-encoding is needed later, we can add `ffmpeg.wasm` — flagging as a known trade-off, not building it in v1.

## Phase 4 — Public Verification

Routes:
- `/verify` — clean search bar, paste a Certificate ID, submit
- `/verify/$id` — result page

Server function `verifyCertificate(id)` uses `supabaseAdmin` to read the safe view only. Renders:
- ✅ Confirmation card: project name, creation date, **"100% Human Process Confirmed"** badge
- ❌ Not-found card with a polite message

Video URLs are never returned to the public endpoint.

## File map

```text
src/routes/
  index.tsx                 # marketing landing
  login.tsx
  verify.tsx                # search bar
  verify.$id.tsx            # result card
  _authenticated.tsx        # auth gate
  _authenticated/
    record.tsx              # recorder
    dashboard.tsx           # list of user's certificates
src/components/
  recorder/RecorderShell.tsx
  recorder/LivePreview.tsx
  recorder/RecordingHUD.tsx
  certificate/CertificatePDF.ts
  verify/VerifyCard.tsx
src/hooks/useMediaRecorder.ts
src/lib/
  certificates.functions.ts # createCertificate, verifyCertificate, listMine
  certificate-id.ts         # CERT-XXXX-XX generator
supabase/migrations/...     # certificates table, RLS, storage bucket, public view
```

## Design direction

Trust-forward, certificate-bureau feel: deep navy + parchment + a single gold accent for the "verified" stamp. Serif display for headings (Instrument Serif), clean sans for body (Work Sans). Subtle paper texture on the certificate card; everything else minimal.

## What v1 explicitly does NOT include

- Server-side video re-encoding (uses native webm)
- Tamper-proof hashing / blockchain anchoring (can add later by hashing the blob and storing the digest)
- Admin moderation tools
- Email delivery of certificates

Ready to switch to build mode and ship Phase 1 → 4 in order.
