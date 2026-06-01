import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { supabase } from "@/integrations/supabase/client";
import { createCertificate } from "@/lib/certificates.functions";
import { finalizeCertificate } from "@/lib/certificate-finalize.functions";
import { createDraft, getDraft, deleteDraft } from "@/lib/drafts.functions";
import { getMyProfile } from "@/lib/profile.functions";
import { generateCombinedPdf } from "@/lib/certificate-pdf";
import { sendTransactionalEmail } from "@/lib/email/send";
import { PreflightChecklist } from "@/components/PreflightChecklist";
import { RecordingControls } from "@/components/RecordingControls";
import { useQuery } from "@tanstack/react-query";
import { Video, Download, Copy, Check, FileText, Save, Camera } from "lucide-react";

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

type Phase = "setup" | "checklist" | "live" | "attach" | "uploading" | "done";

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

  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);

  const createCertFn = useServerFn(createCertificate);
  const finalizeFn = useServerFn(finalizeCertificate);
  const createDraftFn = useServerFn(createDraft);
  const getDraftFn = useServerFn(getDraft);
  const deleteDraftFn = useServerFn(deleteDraft);
  const getProfileFn = useServerFn(getMyProfile);

  const { data: profileData, isLoading: profileLoading } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => getProfileFn(),
  });
  const hasSelfie = Boolean(profileData?.profile?.selfie_path);

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
    if (recorder.screenStream && screenVideoRef.current) {
      screenVideoRef.current.srcObject = recorder.screenStream;
    }
    if (recorder.webcamStream && webcamVideoRef.current) {
      webcamVideoRef.current.srcObject = recorder.webcamStream;
    }
  }, [recorder.screenStream, recorder.webcamStream]);

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
    if (!projectName.trim()) {
      setErrMsg("Give your project a name first.");
      return;
    }
    try {
      await recorder.start();
      setPhase("checklist");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Could not start recording.");
    }
  };

  const handleChecklistCancel = async () => {
    try {
      await recorder.stop().catch(() => {});
    } catch {
      /* noop */
    }
    setPhase("setup");
  };

  const handleStop = async () => {
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
      setUploadMsg("Preparing upload…");

      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error("Not signed in.");

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
        },
      });

      setUploadMsg("Appending certificate to your PDF…");
      const combinedBlob = await generateCombinedPdf(pdfFile, {
        certificateId: cert.certificateId,
        projectName: cert.projectName,
        createdAt: cert.createdAt,
        ownerEmail: user.email ?? null,
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

          <label className="mt-10 block text-sm font-medium">Project name</label>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. Album cover — Aurora"
            className="mt-2 w-full rounded-md border border-input bg-card px-4 py-3 outline-none focus:ring-2 focus:ring-ring"
            maxLength={120}
          />

          {errMsg && (
            <p className="mt-3 text-sm text-destructive bg-destructive/10 rounded px-3 py-2">
              {errMsg}
            </p>
          )}
          <button
            onClick={handleStart}
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
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
          onConfirm={() => setPhase("live")}
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
