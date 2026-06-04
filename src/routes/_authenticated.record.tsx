import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { supabase } from "@/integrations/supabase/client";
import { createCertificate } from "@/lib/certificates.functions";
import { finalizeCertificate } from "@/lib/certificate-finalize.functions";
import { createDraft, getDraft, deleteDraft } from "@/lib/drafts.functions";
import { getMyProfile } from "@/lib/profile.functions";
import { verifySubmission, type CheckResult } from "@/lib/verification.functions";
import {
  issueLivenessChallenge,
  submitLivenessChallenge,
  type LivenessChallenge,
  type LivenessReceipt,
} from "@/lib/liveness.functions";
import {
  extractVideoFramesWithTimestamps,
  extractPdfPageImages,
  extractPdfText,
} from "@/lib/media-sampling";
import { generateCombinedPdf } from "@/lib/certificate-pdf";
import { sendTransactionalEmail } from "@/lib/email/send";
import { submitAppeal } from "@/lib/appeals.functions";
import { PreflightChecklist } from "@/components/PreflightChecklist";
import { RecordingControls } from "@/components/RecordingControls";
import { LivenessOverlay } from "@/components/LivenessOverlay";
import { useQuery } from "@tanstack/react-query";
import { Video, Download, Copy, Check, X, FileText, Save, Camera, ShieldCheck, Sparkles } from "lucide-react";

const searchSchema = z.object({
  draft: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/record")({
  head: () => ({ meta: [{ title: "Record a session — Bio Mark" }] }),
  validateSearch: (search) => searchSchema.parse(search),
  component: RecordPage,
});

interface IssuedCertificate {
  certificateId: string;
  projectName: string;
  createdAt: string;
  ownerEmail: string | null;
  downloadUrl: string;
}

interface PendingRecording {
  // Set when local: blobs in memory. Set when from draft: stored paths.
  screenBlob?: Blob;
  webcamBlob?: Blob;
  screenPath?: string;
  webcamPath?: string;
  durationSeconds: number;
  draftId?: string;
}

const MAX_PDF_BYTES = 20 * 1024 * 1024;

type Phase = "setup" | "checklist" | "live" | "attach" | "uploading" | "done" | "rejected";

function RecordPage() {
  const recorder = useMediaRecorder();
  const navigate = useNavigate();
  const { draft: draftId } = Route.useSearch();

  const [projectName, setProjectName] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [pending, setPending] = useState<PendingRecording | null>(null);
  const [uploadMsg, setUploadMsg] = useState("");
  const [issued, setIssued] = useState<IssuedCertificate | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [verification, setVerification] = useState<{
    checks: CheckResult[];
    summary: string;
    certificateId: string;
  } | null>(null);

  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);

  const createCertFn = useServerFn(createCertificate);
  const finalizeFn = useServerFn(finalizeCertificate);
  const createDraftFn = useServerFn(createDraft);
  const getDraftFn = useServerFn(getDraft);
  const deleteDraftFn = useServerFn(deleteDraft);
  const getProfileFn = useServerFn(getMyProfile);
  const verifyFn = useServerFn(verifySubmission);
  const submitAppealFn = useServerFn(submitAppeal);
  const issueChallengeFn = useServerFn(issueLivenessChallenge);
  const submitChallengeFn = useServerFn(submitLivenessChallenge);
  const [appealNote, setAppealNote] = useState("");
  const [appealing, setAppealing] = useState(false);
  const [appealSent, setAppealSent] = useState(false);

  // ----- Anti-spoofing liveness state -----
  const [activeChallenge, setActiveChallenge] = useState<LivenessChallenge | null>(null);
  const [liveReceipts, setLiveReceipts] = useState<LivenessReceipt[]>([]);
  const [requiredNonces, setRequiredNonces] = useState<string[]>([]);
  const [livenessError, setLivenessError] = useState<string | null>(null);
  const livenessTimerRef = useRef<number | null>(null);
  const livenessBusyRef = useRef(false);

  const { data: profileData, isLoading: profileLoading } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => getProfileFn(),
  });
  const hasSelfie = Boolean(profileData?.profile?.selfie_path);
  const kycStatus = profileData?.profile?.kyc_status ?? "not_started";
  const kycVerified = kycStatus === "verified";
  const canRecord = hasSelfie && kycVerified;

  // If opened with ?draft=<id>, jump straight to the attach phase using stored paths.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!draftId) return;
      try {
        const { draft } = await getDraftFn({ data: { id: draftId } });
        if (cancelled) return;
        setProjectName(draft.project_name);
        setPending({
          screenPath: draft.screen_video_path,
          webcamPath: draft.webcam_video_path,
          durationSeconds: draft.duration_seconds,
          draftId: draft.id,
        });
        setPhase("attach");
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : "Could not load draft.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId, getDraftFn]);

  useEffect(() => {
    const attach = (el: HTMLVideoElement | null, stream: MediaStream | null) => {
      if (!el || !stream) return;
      if (el.srcObject !== stream) el.srcObject = stream;
      el.play().catch(() => {});
    };
    attach(screenVideoRef.current, recorder.screenStream);
    attach(webcamVideoRef.current, recorder.webcamStream);
  }, [recorder.screenStream, recorder.webcamStream, phase]);

  const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) return setPdfFile(null);
    if (f.type !== "application/pdf") {
      setErrMsg("Please attach a PDF file.");
      return;
    }
    if (f.size > MAX_PDF_BYTES) {
      setErrMsg("PDF is too large (max 20 MB).");
      return;
    }
    setErrMsg(null);
    setPdfFile(f);
  };

  const handleStart = async () => {
    setErrMsg(null);
    if (!hasSelfie) {
      setErrMsg("Add a verification selfie to your profile before recording.");
      return;
    }
    if (!kycVerified) {
      setErrMsg(
        "Complete identity verification on your profile before creating a project.",
      );
      return;
    }
    if (!projectName.trim()) {
      setErrMsg("Give your project a name first.");
      return;
    }
    try {
      await recorder.prepare();
      setPhase("checklist");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Could not start recording.");
    }
  };

  const handleChecklistCancel = () => {
    recorder.cancel();
    setPhase("setup");
  };

  // Snap a single frame from the live webcam stream for liveness verification.
  const snapWebcamFrame = useCallback((): string | null => {
    const v = webcamVideoRef.current;
    if (!v) return null;
    const w = v.videoWidth || 640;
    const h = v.videoHeight || 480;
    if (w === 0 || h === 0) return null;
    const scale = Math.min(1, 480 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try {
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    } catch {
      return null;
    }
    return canvas.toDataURL("image/jpeg", 0.7);
  }, []);

  // Run a single liveness challenge: issue → show overlay → snap frame →
  // submit → store receipt + nonce. Returns when done (overlay closed).
  const runOneChallenge = useCallback(async () => {
    if (livenessBusyRef.current) return;
    livenessBusyRef.current = true;
    setLivenessError(null);
    try {
      const challenge = await issueChallengeFn();
      setRequiredNonces((prev) => Array.from(new Set([...prev, challenge.nonce])));
      setActiveChallenge(challenge);
      // The overlay snaps the frame mid-way and then calls onDone after a moment.
      // We resolve when onDone fires — see the overlay handlers below.
    } catch (e) {
      livenessBusyRef.current = false;
      setLivenessError(
        e instanceof Error ? e.message : "Could not start liveness challenge.",
      );
    }
  }, [issueChallengeFn]);

  // Schedule challenges at random intervals during the live phase.
  useEffect(() => {
    if (phase !== "live" || recorder.state !== "recording") return;
    const scheduleNext = (minMs: number, maxMs: number) => {
      const delay = minMs + Math.random() * (maxMs - minMs);
      livenessTimerRef.current = window.setTimeout(async () => {
        await runOneChallenge();
        // Schedule another one if user keeps recording.
        scheduleNext(55_000, 95_000);
      }, delay);
    };
    // First challenge between 20 and 40 seconds in.
    scheduleNext(20_000, 40_000);
    return () => {
      if (livenessTimerRef.current) {
        window.clearTimeout(livenessTimerRef.current);
        livenessTimerRef.current = null;
      }
    };
  }, [phase, recorder.state, runOneChallenge]);

  // Issue the OPENING nonce as soon as recording begins so the user has a
  // code to type into their document right away.
  useEffect(() => {
    if (phase !== "live") return;
    let cancelled = false;
    (async () => {
      try {
        const opening = await issueChallengeFn();
        if (cancelled) return;
        // Only register the nonce — don't show the overlay for the opening one.
        setRequiredNonces((prev) =>
          prev.length === 0 ? [opening.nonce] : prev,
        );
      } catch (e) {
        if (!cancelled) {
          setLivenessError(
            e instanceof Error ? e.message : "Could not issue session code.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleChallengeSnap = useCallback(async () => {
    const challenge = activeChallenge;
    if (!challenge) return;
    const frame = snapWebcamFrame();
    if (!frame) {
      setLivenessError("Could not capture webcam frame for liveness check.");
      return;
    }
    try {
      const receipt = await submitChallengeFn({
        data: { challenge, webcamFrameDataUrl: frame },
      });
      setLiveReceipts((prev) => [...prev, receipt]);
      if (!receipt.ok) {
        setLivenessError(
          `Liveness check did not pass: ${receipt.reason || "pose or screen-flash colour not detected."} Another challenge will follow.`,
        );
      }
    } catch (e) {
      setLivenessError(
        e instanceof Error ? e.message : "Liveness check failed.",
      );
    }
  }, [activeChallenge, snapWebcamFrame, submitChallengeFn]);

  const handleChallengeDone = useCallback(() => {
    setActiveChallenge(null);
    livenessBusyRef.current = false;
  }, []);

  const handleStop = async () => {
    if (livenessTimerRef.current) {
      window.clearTimeout(livenessTimerRef.current);
      livenessTimerRef.current = null;
    }
    setActiveChallenge(null);
    try {
      const result = await recorder.stop();
      setPending({
        screenBlob: result.screenBlob,
        webcamBlob: result.webcamBlob,
        durationSeconds: result.durationSeconds,
      });
      setPhase("attach");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Could not stop recording.");
    }
  };

  const downloadStorage = async (bucket: string, path: string): Promise<Blob> => {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) throw new Error(error?.message ?? "Could not download file");
    return data;
  };

  // Upload recording blobs to storage (used both for "save as draft" and "submit")
  const ensureUploaded = async (
    userId: string,
    stamp: number,
  ): Promise<{ screenPath: string; webcamPath: string }> => {
    if (!pending) throw new Error("No recording");
    if (pending.screenPath && pending.webcamPath) {
      return { screenPath: pending.screenPath, webcamPath: pending.webcamPath };
    }
    if (!pending.screenBlob || !pending.webcamBlob) {
      throw new Error("Recording missing");
    }
    const screenPath = `${userId}/${stamp}-screen.webm`;
    const webcamPath = `${userId}/${stamp}-webcam.webm`;

    setUploadMsg("Uploading screen recording…");
    const up1 = await supabase.storage
      .from("recordings")
      .upload(screenPath, pending.screenBlob, { contentType: "video/webm" });
    if (up1.error) throw new Error(up1.error.message);

    setUploadMsg("Uploading webcam recording…");
    const up2 = await supabase.storage
      .from("recordings")
      .upload(webcamPath, pending.webcamBlob, { contentType: "video/webm" });
    if (up2.error) throw new Error(up2.error.message);

    return { screenPath, webcamPath };
  };

  const handleSaveDraft = async () => {
    if (!pending) return;
    setErrMsg(null);
    setSavingDraft(true);
    try {
      setPhase("uploading");
      setUploadMsg("Saving draft…");
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error("Not signed in.");
      const stamp = Date.now();
      const { screenPath, webcamPath } = await ensureUploaded(user.id, stamp);
      await createDraftFn({
        data: {
          projectName: projectName.trim() || "Untitled",
          screenVideoPath: screenPath,
          webcamVideoPath: webcamPath,
          durationSeconds: pending.durationSeconds,
        },
      });
      navigate({ to: "/dashboard" });
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Could not save draft.");
      setPhase("attach");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleFinalize = async () => {
    setErrMsg(null);
    if (!pending) {
      setErrMsg("Recording missing. Please try again.");
      return;
    }
    if (!pdfFile) {
      setErrMsg("Attach the completed PDF you produced during the recording.");
      return;
    }
    try {
      setPhase("uploading");
      setUploadMsg("Preparing verification…");

      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error("Not signed in.");

      // ----- Verify FIRST, before uploading or issuing anything -----
      // On failure no certificate row is created, nothing is uploaded,
      // and no email is sent.
      const screenBlobForFrames =
        pending.screenBlob ??
        (pending.screenPath
          ? await downloadStorage("recordings", pending.screenPath)
          : null);
      const webcamBlobForFrames =
        pending.webcamBlob ??
        (pending.webcamPath
          ? await downloadStorage("recordings", pending.webcamPath)
          : null);
      if (!screenBlobForFrames || !webcamBlobForFrames) {
        throw new Error("Recording missing — please record again.");
      }

      setUploadMsg("Sampling recording for verification…");
      const [screenFrames, webcamFrames, pdfPageImages] = await Promise.all([
        // End-weighted so we get strong coverage of the final document state.
        extractVideoFramesWithTimestamps(screenBlobForFrames, 24, 1600, {
          endWeighted: true,
        }),
        extractVideoFramesWithTimestamps(webcamBlobForFrames, 8, 480),
        extractPdfPageImages(pdfFile, 6, 900),
      ]);

      setUploadMsg("Running Gemini verification (this can take ~30 s)…");
      const verdict = await verifyFn({
        data: {
          screenFrames,
          webcamFrames,
          pdfPageImages,
          durationSeconds: pending.durationSeconds,
          projectName: projectName.trim(),
        },
      });

      if (!verdict.passed) {
        setVerification({
          checks: verdict.checks,
          summary: verdict.summary,
          certificateId: "",
        });
        setPhase("rejected");
        return;
      }

      // ----- Verification passed: upload artifacts and issue cert -----
      const stamp = Date.now();
      const { screenPath, webcamPath } = await ensureUploaded(user.id, stamp);
      const originalPdfPath = `${user.id}/${stamp}-original.pdf`;

      setUploadMsg("Uploading your document…");
      const up3 = await supabase.storage
        .from("documents")
        .upload(originalPdfPath, pdfFile, { contentType: "application/pdf" });
      if (up3.error) throw new Error(up3.error.message);

      setUploadMsg("Issuing certificate…");
      const cert = await createCertFn({
        data: {
          projectName: projectName.trim(),
          screenVideoPath: screenPath,
          webcamVideoPath: webcamPath,
          durationSeconds: pending.durationSeconds,
          verification: {
            checks: verdict.checks,
            summary: verdict.summary,
          },
        },
      });

      setUploadMsg("Appending certificate to your PDF…");
      const combinedBlob = await generateCombinedPdf(pdfFile, {
        certificateId: cert.certificateId,
        projectName: cert.projectName,
        createdAt: cert.createdAt,
        ownerEmail: user.email ?? null,
        checks: verdict.checks,
        summary: verdict.summary,
      });

      const combinedPdfPath = `${user.id}/${stamp}-${cert.certificateId}-combined.pdf`;
      setUploadMsg("Saving certified PDF…");
      const up4 = await supabase.storage
        .from("documents")
        .upload(combinedPdfPath, combinedBlob, { contentType: "application/pdf" });
      if (up4.error) throw new Error(up4.error.message);

      setUploadMsg("Generating secure download link…");
      const final = await finalizeFn({
        data: {
          certificateId: cert.certificateId,
          documentPdfPath: originalPdfPath,
          combinedPdfPath,
        },
      });

      setUploadMsg("Sending email…");
      try {
        if (user.email) {
          await sendTransactionalEmail({
            templateName: "verification-complete",
            recipientEmail: user.email,
            idempotencyKey: `verification-complete-${cert.certificateId}`,
            templateData: {
              projectName: cert.projectName,
              certificateId: cert.certificateId,
              downloadUrl: final.downloadUrl,
              verifyUrl: `${window.location.origin}/verify/${cert.certificateId}`,
            },
          });
        }
      } catch (mailErr) {
        console.error("Failed to send certificate email", mailErr);
      }

      // If this was loaded from a draft, clean it up.
      if (pending.draftId) {
        try {
          await deleteDraftFn({ data: { id: pending.draftId } });
        } catch (e) {
          console.warn("Could not delete draft after submission", e);
        }
      }

      setIssued({
        certificateId: cert.certificateId,
        projectName: cert.projectName,
        createdAt: cert.createdAt,
        ownerEmail: user.email ?? null,
        downloadUrl: final.downloadUrl,
      });
      setPhase("done");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Upload failed.");
      setPhase("attach");
    }
  };

  if (phase === "done" && issued) {
    return <Success issued={issued} />;
  }

  if (phase === "rejected" && verification) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm uppercase tracking-widest text-destructive">
          Verification failed
        </p>
        <h1 className="mt-2 font-display text-4xl">
          We couldn't issue this certificate
        </h1>
        <p className="mt-3 text-muted-foreground">
          Every Bio Mark certificate has to clear a series of automated
          integrity checks — including live screen-flash and pose challenges
          and proof that randomised codes shown during the recording were
          typed into the document. One or more checks didn't pass for this
          submission, so no certificate was issued and no email was sent.
        </p>
        {verification.summary && (
          <p className="mt-3 rounded-md bg-card border border-border p-3 text-sm">
            {verification.summary}
          </p>
        )}
        <ul className="mt-8 space-y-3">
          {verification.checks.map((c) => (
            <li
              key={c.key}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                {c.passed ? (
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                ) : (
                  <X className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                )}
                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{c.label}</p>
                    <span className="text-xs uppercase tracking-widest text-muted-foreground">
                      {c.confidence} confidence
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{c.reason}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-8 rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-2xl">Appeal this decision</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            If you believe this was wrong, you can appeal. Your full evidence
            (screen recording, webcam, and PDF) will be sent to a human
            reviewer who can reverse or uphold the decision. You'll get an
            email either way.
          </p>
          {appealSent ? (
            <p className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
              Appeal submitted. We've emailed the reviewer — you'll hear back by email.
            </p>
          ) : (
            <>
              <textarea
                value={appealNote}
                onChange={(e) => setAppealNote(e.target.value)}
                placeholder="Optional: add any context for the reviewer…"
                className="mt-3 w-full min-h-[80px] rounded-md border border-input bg-background p-3 text-sm"
              />
              <button
                disabled={appealing}
                onClick={async () => {
                  if (!pending || !pdfFile) {
                    setErrMsg("Recording or PDF is missing — please retry.");
                    return;
                  }
                  setAppealing(true);
                  setErrMsg(null);
                  try {
                    const { data: userData } = await supabase.auth.getUser();
                    const user = userData.user;
                    if (!user) throw new Error("Not signed in.");
                    const stamp = Date.now();
                    setUploadMsg("Uploading evidence for appeal…");
                    const { screenPath, webcamPath } = await ensureUploaded(
                      user.id,
                      stamp,
                    );
                    const originalPdfPath = `${user.id}/${stamp}-appeal.pdf`;
                    const up = await supabase.storage
                      .from("documents")
                      .upload(originalPdfPath, pdfFile, {
                        contentType: "application/pdf",
                      });
                    if (up.error) throw new Error(up.error.message);
                    await submitAppealFn({
                      data: {
                        projectName: projectName.trim() || "Untitled",
                        screenVideoPath: screenPath,
                        webcamVideoPath: webcamPath,
                        originalPdfPath,
                        durationSeconds: pending.durationSeconds,
                        geminiChecks: verification.checks,
                        geminiSummary: verification.summary,
                        userNote: appealNote.trim() || undefined,
                      },
                    });
                    setAppealSent(true);
                  } catch (e) {
                    setErrMsg(
                      e instanceof Error ? e.message : "Could not submit appeal.",
                    );
                  } finally {
                    setAppealing(false);
                  }
                }}
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                <ShieldCheck className="h-4 w-4" />
                {appealing ? "Submitting…" : "Submit appeal"}
              </button>
            </>
          )}
        </div>
        <div className="mt-6 flex gap-2">
          <button
            onClick={() => {
              setVerification(null);
              setAppealSent(false);
              setAppealNote("");
              setPhase("attach");
            }}
            className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm hover:bg-accent"
          >
            <FileText className="h-4 w-4" /> Try a different PDF
          </button>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <ShieldCheck className="h-4 w-4" /> Back to dashboard
          </Link>
        </div>

      </main>
    );
  }


  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      {phase === "setup" && (
        <div className="max-w-xl">
          <h1 className="font-display text-5xl">New session</h1>
          <p className="mt-3 text-muted-foreground">
            We'll record your screen and webcam together while you work. When you stop,
            you'll attach the completed PDF you produced during the session — we'll
            append a signed certificate to it and email it to you.
          </p>

          {!profileLoading && !hasSelfie && (
            <div className="mt-8 rounded-xl border border-gold/40 bg-gold/5 p-5">
              <div className="flex items-start gap-3">
                <Camera className="h-5 w-5 mt-0.5 text-gold" />
                <div>
                  <p className="font-medium">Add a verification selfie first</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Before your first recording we capture a one-time selfie that
                    stays on your profile. It's used to confirm the same person
                    appears in every certified session.
                  </p>
                  <Link
                    to="/profile"
                    className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    <Camera className="h-4 w-4" /> Take selfie
                  </Link>
                </div>
              </div>
            </div>
          )}

          {!profileLoading && hasSelfie && !kycVerified && (
            <div className="mt-8 rounded-xl border border-gold/40 bg-gold/5 p-5">
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 mt-0.5 text-gold" />
                <div>
                  <p className="font-medium">
                    {kycStatus === "in_progress" ||
                    kycStatus === "in_review" ||
                    kycStatus === "pending"
                      ? "Identity verification in progress"
                      : kycStatus === "declined"
                        ? "Identity verification was declined"
                        : "Verify your identity to continue"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Before your first project, we verify your government ID and
                    a live selfie through our partner Didit. This protects every
                    certificate you issue.
                  </p>
                  <Link
                    to="/profile"
                    className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {kycStatus === "in_progress" ||
                    kycStatus === "in_review" ||
                    kycStatus === "pending"
                      ? "Check verification status"
                      : kycStatus === "declined"
                        ? "Retry verification"
                        : "Verify identity"}
                  </Link>
                </div>
              </div>
            </div>
          )}

          <label className="mt-10 block text-sm font-medium">Project name</label>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. Album cover — Aurora"
            className="mt-2 w-full rounded-md border border-input bg-card px-4 py-3 outline-none focus:ring-2 focus:ring-ring"
            maxLength={120}
            disabled={!canRecord}
          />

          {errMsg && (
            <p className="mt-3 text-sm text-destructive bg-destructive/10 rounded px-3 py-2">
              {errMsg}
            </p>
          )}
          <button
            onClick={handleStart}
            disabled={!canRecord}
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Video className="h-4 w-4" />
            Start Session
          </button>
          <p className="mt-4 text-xs text-muted-foreground">
            Your browser will ask permission to share screen, camera, and microphone.
            We'll run a quick checklist before recording starts.
          </p>
        </div>
      )}

      {phase === "checklist" && (
        <PreflightChecklist
          screenStream={recorder.screenStream}
          webcamStream={recorder.webcamStream}
          onCancel={handleChecklistCancel}
          onConfirm={() => {
            try {
              recorder.beginRecording();
              setPhase("live");
            } catch (e) {
              setErrMsg(e instanceof Error ? e.message : "Could not start recording.");
              setPhase("setup");
            }
          }}
        />
      )}

      {phase === "live" && (
        <div>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm uppercase tracking-widest text-destructive">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    recorder.state === "paused"
                      ? "bg-muted-foreground"
                      : "animate-pulse bg-destructive"
                  }`}
                />
                {recorder.state === "paused" ? "Paused" : "Recording"}
              </div>
              <h1 className="mt-2 font-display text-3xl">{projectName}</h1>
            </div>
            <div className="text-right">
              <div className="font-mono text-3xl tabular-nums">
                {formatTime(recorder.elapsed)}
              </div>
            </div>
          </div>

          <div className="relative mt-8 overflow-hidden rounded-xl border border-border bg-black">
            <video
              ref={screenVideoRef}
              autoPlay
              muted
              playsInline
              className="aspect-video w-full"
            />
            <div className="absolute bottom-4 right-4 h-32 w-44 overflow-hidden rounded-lg border-2 border-background shadow-2xl">
              <video
                ref={webcamVideoRef}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover"
              />
            </div>
          </div>

          <RecordingControls
            elapsed={recorder.elapsed}
            paused={recorder.state === "paused"}
            onPause={recorder.pause}
            onResume={recorder.resume}
            onStop={handleStop}
          />
        </div>
      )}

      {(phase === "attach" || phase === "uploading") && pending && (
        <div className="max-w-xl">
          <p className="text-sm uppercase tracking-widest text-gold">
            {pending.draftId ? "Draft recording" : "Recording complete"}
          </p>
          <h1 className="mt-2 font-display text-4xl">{projectName || "Untitled"}</h1>
          <p className="mt-3 text-muted-foreground">
            Recorded {formatTime(pending.durationSeconds)}. Attach the completed PDF
            version of the document you produced during the session — we'll append the
            Certificate of Authenticity as the final page and email you a secure
            download link. Not ready yet? Save it as a draft and come back later.
          </p>

          <label className="mt-8 block text-sm font-medium">
            Completed document (PDF)
          </label>
          <div className="mt-2 rounded-md border border-dashed border-input bg-card px-4 py-4">
            <input
              type="file"
              accept="application/pdf"
              onChange={handlePdfChange}
              disabled={phase === "uploading"}
              className="block w-full text-sm file:mr-4 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-accent disabled:opacity-60"
            />
            {pdfFile && (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4 text-gold" />
                <span className="truncate">{pdfFile.name}</span>
                <span className="text-xs">
                  ({(pdfFile.size / 1024 / 1024).toFixed(2)} MB)
                </span>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Required to submit. Max 20 MB.</p>
          </div>

          {errMsg && (
            <p className="mt-3 text-sm text-destructive bg-destructive/10 rounded px-3 py-2">
              {errMsg}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={handleFinalize}
              disabled={phase === "uploading" || !pdfFile}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {phase === "uploading" && !savingDraft ? "Processing…" : "Submit for verification"}
            </button>
            {!pending.draftId && (
              <button
                onClick={handleSaveDraft}
                disabled={phase === "uploading"}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-3 text-sm font-medium hover:bg-secondary disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {savingDraft ? "Saving…" : "Save as draft"}
              </button>
            )}
          </div>

          {phase === "uploading" && (
            <p className="mt-4 text-sm text-muted-foreground">{uploadMsg}</p>
          )}
        </div>
      )}
    </main>
  );
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function Success({ issued }: { issued: IssuedCertificate }) {
  const [copied, setCopied] = useState(false);
  const verifyUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/verify/${issued.certificateId}`;

  const copy = async () => {
    await navigator.clipboard.writeText(issued.certificateId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm uppercase tracking-widest text-gold">Certificate issued</p>
      <h1 className="mt-3 font-display text-5xl">{issued.projectName}</h1>
      <p className="mt-3 text-muted-foreground">
        We've appended the certificate to your PDF and emailed you a secure download link.
        You can also grab it below.
      </p>

      <div className="certificate-paper mt-10 rounded-xl p-8">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Certificate ID
        </div>
        <div className="mt-2 flex items-center gap-3">
          <code className="font-mono text-3xl text-primary">{issued.certificateId}</code>
          <button
            onClick={copy}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-secondary"
          >
            {copied ? (
              <span className="inline-flex items-center gap-1">
                <Check className="h-3 w-3" /> Copied
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Copy className="h-3 w-3" /> Copy
              </span>
            )}
          </button>
        </div>
        <div className="mt-6 text-sm text-muted-foreground">
          Verify URL: <span className="text-foreground">{verifyUrl}</span>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <a
          href={issued.downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Download className="h-4 w-4" />
          Download certified PDF
        </a>
        <Link
          to="/dashboard"
          className="rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium hover:bg-secondary"
        >
          View all certificates
        </Link>
      </div>
    </main>
  );
}
