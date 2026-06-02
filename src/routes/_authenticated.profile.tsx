import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Camera, RefreshCw, Check, ShieldCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile, setProfileSelfie } from "@/lib/profile.functions";
import { startDiditVerification } from "@/lib/didit.functions";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Your profile — Bio Mark" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const getProfileFn = useServerFn(getMyProfile);
  const setSelfieFn = useServerFn(setProfileSelfie);
  const startKycFn = useServerFn(startDiditVerification);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [streamReady, setStreamReady] = useState(false);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [kycStarting, setKycStarting] = useState(false);
  const [kycWindow, setKycWindow] = useState<Window | null>(null);

  const { data: profileData, refetch } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => getProfileFn(),
    // Poll while the user is mid-verification so the UI flips to "verified"
    // as soon as the webhook updates the row.
    refetchInterval: (q) => {
      const s = q.state.data?.profile?.kyc_status;
      return s === "in_progress" || s === "in_review" || s === "pending"
        ? 4000
        : false;
    },
  });
  const existingSelfiePath = profileData?.profile?.selfie_path ?? null;
  const kycStatus = profileData?.profile?.kyc_status ?? "not_started";
  const kycSessionUrl = profileData?.profile?.kyc_session_url ?? null;

  const startKyc = async () => {
    setErr(null);
    setKycStarting(true);
    try {
      const res = await startKycFn();
      // Open in a popup window so the user stays on our page.
      const w = window.open(
        res.url,
        "didit-kyc",
        "width=480,height=720,noopener,noreferrer",
      );
      setKycWindow(w);
      await refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start verification.");
    } finally {
      setKycStarting(false);
    }
  };

  // Detect when the KYC popup is closed and refresh status.
  useEffect(() => {
    if (!kycWindow) return;
    const t = setInterval(() => {
      if (kycWindow.closed) {
        clearInterval(t);
        setKycWindow(null);
        void refetch();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [kycWindow, refetch]);

  // Fetch signed URL for current selfie
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!existingSelfiePath) {
        setSelfieUrl(null);
        return;
      }
      const { data } = await supabase.storage
        .from("selfies")
        .createSignedUrl(existingSelfiePath, 600);
      if (!cancelled) setSelfieUrl(data?.signedUrl ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [existingSelfiePath]);

  const startCamera = async () => {
    setErr(null);
    setCapturedDataUrl(null);
    setCapturedBlob(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      setStreamReady(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not access camera.");
    }
  };

  // Attach the live stream to the <video> AFTER it mounts (streamReady toggles it on).
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!streamReady || !video || !stream) return;
    video.srcObject = stream;
    const tryPlay = () => video.play().catch(() => {});
    if (video.readyState >= 1) tryPlay();
    else video.onloadedmetadata = tryPlay;
  }, [streamReady]);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreamReady(false);
  };

  useEffect(() => () => stopCamera(), []);

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedBlob(blob);
        setCapturedDataUrl(canvas.toDataURL("image/jpeg", 0.9));
        stopCamera();
      },
      "image/jpeg",
      0.9,
    );
  };

  const retake = () => {
    setCapturedDataUrl(null);
    setCapturedBlob(null);
    void startCamera();
  };

  const save = async () => {
    if (!capturedBlob) return;
    setErr(null);
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error("Not signed in.");
      const path = `${user.id}/selfie-${Date.now()}.jpg`;
      const up = await supabase.storage
        .from("selfies")
        .upload(path, capturedBlob, {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (up.error) throw new Error(up.error.message);
      await setSelfieFn({ data: { selfiePath: path } });
      await refetch();
      setCapturedBlob(null);
      setCapturedDataUrl(null);
      // If user came here to unblock recording, send them along.
      navigate({ to: "/record" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save selfie.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm uppercase tracking-widest text-gold">Profile</p>
      <h1 className="mt-2 font-display text-4xl">Identity selfie</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        We capture a one-time selfie that's attached to your profile. It's used
        only to confirm the same person appears in every certified recording.
        It's stored privately and never shown publicly.
      </p>

      {/* KYC verification card */}
      <section className="mt-8 rounded-xl border border-border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-primary/10 p-3 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-xl">Identity verification</h2>
              <KycBadge status={kycStatus} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Verify your government-issued ID and a live selfie through our
              partner Didit. This is required before you can issue certified
              recordings.
            </p>

            {kycStatus === "verified" ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-emerald-400">
                <Check className="h-4 w-4" />
                Identity verified
                {profileData?.profile?.kyc_verified_at && (
                  <span className="text-muted-foreground">
                    · {new Date(profileData.profile.kyc_verified_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            ) : kycStatus === "in_progress" ||
              kycStatus === "in_review" ||
              kycStatus === "pending" ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {kycStatus === "in_review"
                    ? "Under review — we'll update this automatically."
                    : "Verification in progress…"}
                </div>
                {kycSessionUrl && (
                  <a
                    href={kycSessionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    Resume verification
                  </a>
                )}
              </div>
            ) : (
              <button
                onClick={startKyc}
                disabled={kycStarting}
                className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {kycStarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {kycStatus === "declined"
                  ? "Retry verification"
                  : "Verify identity"}
              </button>
            )}
          </div>
        </div>
      </section>


      {existingSelfiePath && !capturedDataUrl && !streamReady && (
        <div className="mt-8 rounded-xl border border-border bg-card p-6">
          <div className="flex items-start gap-6">
            <div className="h-32 w-32 overflow-hidden rounded-lg border border-border bg-black">
              {selfieUrl ? (
                <img
                  src={selfieUrl}
                  alt="Your verification selfie"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  Loading…
                </div>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <Check className="h-4 w-4" /> Selfie on file
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                You can re-take it any time — it only ever stores the most recent
                photo.
              </p>
              <button
                onClick={startCamera}
                className="mt-4 inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm hover:bg-accent"
              >
                <RefreshCw className="h-4 w-4" />
                Re-take selfie
              </button>
              <Link
                to="/record"
                className="ml-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Continue to record
              </Link>
            </div>
          </div>
        </div>
      )}

      {!existingSelfiePath && !streamReady && !capturedDataUrl && (
        <div className="mt-8">
          <button
            onClick={startCamera}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Camera className="h-4 w-4" />
            Turn on camera
          </button>
        </div>
      )}

      {streamReady && (
        <div className="mt-8">
          <div className="overflow-hidden rounded-xl border border-border bg-black">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="aspect-video w-full object-cover"
            />
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={capture}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Camera className="h-4 w-4" />
              Take selfie
            </button>
            <button
              onClick={stopCamera}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {capturedDataUrl && (
        <div className="mt-8">
          <div className="overflow-hidden rounded-xl border border-border bg-black">
            <img src={capturedDataUrl} alt="Preview" className="w-full" />
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              {saving ? "Saving…" : "Save selfie"}
            </button>
            <button
              onClick={retake}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className="h-4 w-4" />
              Re-take
            </button>
          </div>
        </div>
      )}

      {err && (
        <p className="mt-4 rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </p>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </main>
  );
}

function KycBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    verified: {
      label: "Verified",
      cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    },
    in_progress: {
      label: "In progress",
      cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    },
    pending: {
      label: "In progress",
      cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    },
    in_review: {
      label: "In review",
      cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    },
    declined: {
      label: "Declined",
      cls: "bg-destructive/10 text-destructive border-destructive/20",
    },
    not_started: {
      label: "Not started",
      cls: "bg-muted text-muted-foreground border-border",
    },
  };
  const s = map[status] ?? map.not_started;
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}
    >
      {s.label}
    </span>
  );
}
