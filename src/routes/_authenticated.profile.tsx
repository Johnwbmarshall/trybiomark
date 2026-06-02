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

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [streamReady, setStreamReady] = useState(false);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);

  const { data: profileData, refetch } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => getProfileFn(),
  });
  const existingSelfiePath = profileData?.profile?.selfie_path ?? null;

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
