import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, X, Camera, Mic, MonitorPlay, RotateCw } from "lucide-react";
import { checkHumanInFrame } from "@/lib/vision.functions";
import { useAudioLevel } from "@/hooks/useAudioLevel";
import { MicTroubleshootPanel } from "./MicTroubleshootPanel";

interface Props {
  screenStream: MediaStream | null;
  webcamStream: MediaStream | null;
  onConfirm: () => void;
  onCancel: () => void;
}

type CheckState = "idle" | "running" | "pass" | "fail";

const AUDIO_THRESHOLD = 0.06; // RMS — quiet talk easily exceeds this

export function PreflightChecklist({
  screenStream,
  webcamStream,
  onConfirm,
  onCancel,
}: Props) {
  const webcamRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const checkFn = useServerFn(checkHumanInFrame);

  const [humanCheck, setHumanCheck] = useState<CheckState>("idle");
  const [humanMsg, setHumanMsg] = useState("");
  const [audioPass, setAudioPass] = useState(false);
  const [screenConfirmed, setScreenConfirmed] = useState(false);

  const audioLevel = useAudioLevel(webcamStream);

  useEffect(() => {
    if (webcamRef.current && webcamStream) webcamRef.current.srcObject = webcamStream;
    if (screenRef.current && screenStream) screenRef.current.srcObject = screenStream;
  }, [webcamStream, screenStream]);

  // Auto-pass audio once we see a loud-enough sample for ~200ms
  const aboveCountRef = useRef(0);
  useEffect(() => {
    if (audioPass) return;
    if (audioLevel > AUDIO_THRESHOLD) {
      aboveCountRef.current += 1;
      if (aboveCountRef.current >= 6) setAudioPass(true);
    } else {
      aboveCountRef.current = 0;
    }
  }, [audioLevel, audioPass]);

  const runHumanCheck = async () => {
    const video = webcamRef.current;
    if (!video || !webcamStream) return;
    setHumanCheck("running");
    setHumanMsg("");
    try {
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      const canvas = document.createElement("canvas");
      // downscale to keep payload small
      const scale = Math.min(1, 480 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      const verdict = await checkFn({ data: { imageDataUrl: dataUrl } });
      setHumanMsg(verdict.reason);
      setHumanCheck(verdict.ok ? "pass" : "fail");
    } catch (e) {
      setHumanCheck("fail");
      setHumanMsg(e instanceof Error ? e.message : "Vision check failed.");
    }
  };

  // Auto-run vision check once on mount
  useEffect(() => {
    if (humanCheck === "idle" && webcamStream) {
      const t = setTimeout(() => runHumanCheck(), 800);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webcamStream]);

  const allPass = humanCheck === "pass" && audioPass && screenConfirmed;
  const audioPct = Math.round(Math.min(100, (audioLevel / AUDIO_THRESHOLD) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-2xl">Pre-flight checklist</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Three quick checks before recording begins.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div>
            <div className="overflow-hidden rounded-lg border border-border bg-black">
              <video
                ref={webcamRef}
                autoPlay
                muted
                playsInline
                className="aspect-video w-full object-cover"
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Webcam preview</p>
          </div>
          <div>
            <div className="overflow-hidden rounded-lg border border-border bg-black">
              <video
                ref={screenRef}
                autoPlay
                muted
                playsInline
                className="aspect-video w-full"
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Shared screen preview</p>
          </div>
        </div>

        <ul className="mt-6 space-y-3">
          <CheckRow
            icon={<Camera className="h-4 w-4" />}
            title="One human on camera"
            state={humanCheck === "pass" ? "pass" : humanCheck === "running" ? "running" : humanCheck === "fail" ? "fail" : "idle"}
            description={
              humanCheck === "running"
                ? "Analysing webcam frame…"
                : humanMsg || "We'll snap a frame and verify."
            }
            action={
              humanCheck !== "running" && humanCheck !== "pass" ? (
                <button
                  onClick={runHumanCheck}
                  className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-xs hover:bg-secondary"
                >
                  <RotateCw className="h-3 w-3" />
                  {humanCheck === "fail" ? "Retry" : "Check"}
                </button>
              ) : null
            }
          />
          <CheckRow
            icon={<Mic className="h-4 w-4" />}
            title="Microphone is picking up audio"
            state={audioPass ? "pass" : "running"}
            description={audioPass ? "Audio detected." : "Say something — we're listening…"}
            extra={
              !audioPass ? (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full bg-gold transition-[width] duration-75"
                    style={{ width: `${audioPct}%` }}
          />
          <MicTroubleshootPanel webcamStream={webcamStream} audioLevel={audioLevel} />
                </div>
              ) : null
            }
          />
          <CheckRow
            icon={<MonitorPlay className="h-4 w-4" />}
            title="The right screen is being shared"
            state={screenConfirmed ? "pass" : "idle"}
            description="Check the screen preview, then confirm."
            action={
              !screenConfirmed ? (
                <button
                  onClick={() => setScreenConfirmed(true)}
                  className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-xs hover:bg-secondary"
                >
                  Confirm
                </button>
              ) : null
            }
          />
        </ul>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            disabled={!allPass}
            onClick={onConfirm}
            className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Begin recording
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckRow({
  icon,
  title,
  state,
  description,
  action,
  extra,
}: {
  icon: React.ReactNode;
  title: string;
  state: "idle" | "running" | "pass" | "fail";
  description: string;
  action?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <li className="rounded-lg border border-border bg-background/50 p-3">
      <div className="flex items-start gap-3">
        <StateIcon state={state} />
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="text-muted-foreground">{icon}</span>
            <span>{title}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          {extra}
        </div>
        {action}
      </div>
    </li>
  );
}

function StateIcon({ state }: { state: "idle" | "running" | "pass" | "fail" }) {
  if (state === "pass")
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gold/20 text-gold">
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  if (state === "running")
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
    );
  if (state === "fail")
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-destructive/20 text-destructive">
        <X className="h-3.5 w-3.5" />
      </span>
    );
  return (
    <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
    </span>
  );
}
