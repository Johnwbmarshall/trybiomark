import { useCallback, useEffect, useRef, useState } from "react";
import { logMicCaptureError } from "@/components/MicTroubleshootPanel";

export type RecorderState =
  | "idle"
  | "requesting"
  | "recording"
  | "paused"
  | "stopped"
  | "error";

export interface RecordingResult {
  screenBlob: Blob;
  webcamBlob: Blob;
  durationSeconds: number;
}

const microphoneConstraints: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export function useMediaRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenSourceStreamsRef = useRef<MediaStream[]>([]);
  const compositionCleanupRef = useRef<(() => void) | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const webcamRecorderRef = useRef<MediaRecorder | null>(null);
  const screenChunksRef = useRef<Blob[]>([]);
  const webcamChunksRef = useRef<Blob[]>([]);
  const accumulatedRef = useRef<number>(0); // total recorded ms before current run
  const runStartedAtRef = useRef<number>(0); // start of the current (un-paused) run
  const tickRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenSourceStreamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    screenSourceStreamsRef.current = [];
    compositionCleanupRef.current?.();
    compositionCleanupRef.current = null;
    webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    webcamStreamRef.current = null;
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const currentElapsedMs = () =>
    accumulatedRef.current + (runStartedAtRef.current ? Date.now() - runStartedAtRef.current : 0);

  const captureMonitor = async (): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: 30,
        displaySurface: "monitor",
      },
      // Microphone audio is captured on the webcam stream. Do not request
      // screen/system audio here: on some multi-monitor setups that can grab
      // or suppress the default input device, leaving the pre-flight mic meter
      // with a live-but-silent microphone track.
      audio: false,
      // Chromium-only hints to bias the picker toward entire-screen
      ...({
        monitorTypeSurfaces: "include",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
      } as object),
    });
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
    if (settings.displaySurface && settings.displaySurface !== "monitor") {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(
        "Please choose 'Entire Screen' — sharing a window or browser tab is not allowed.",
      );
    }
    return stream;
  };

  const composeScreens = (streams: MediaStream[]): MediaStream => {
    if (streams.length === 1) return streams[0];

    // Build a horizontally-tiled composite canvas of all monitor feeds.
    const videos = streams.map((s) => {
      const v = document.createElement("video");
      v.srcObject = s;
      v.muted = true;
      v.playsInline = true;
      v.play().catch(() => {});
      return v;
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      const sizes = videos.map((v) => ({
        w: v.videoWidth || 1280,
        h: v.videoHeight || 720,
      }));
      const maxH = Math.max(...sizes.map((s) => s.h));
      const totalW = sizes.reduce((acc, s) => acc + Math.round((s.w * maxH) / s.h), 0);
      if (canvas.width !== totalW || canvas.height !== maxH) {
        canvas.width = totalW;
        canvas.height = maxH;
      }
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      let x = 0;
      videos.forEach((v, i) => {
        const w = Math.round((sizes[i].w * maxH) / sizes[i].h);
        try {
          ctx.drawImage(v, x, 0, w, maxH);
        } catch {
          /* not ready yet */
        }
        x += w;
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const composed = (canvas as HTMLCanvasElement).captureStream(30);

    // Mix any audio tracks from screen captures into the composed stream.
    const audioTracks = streams.flatMap((s) => s.getAudioTracks());
    if (audioTracks.length > 0) {
      const AC: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AC();
      const dest = audioCtx.createMediaStreamDestination();
      streams.forEach((s) => {
        if (s.getAudioTracks().length === 0) return;
        const src = audioCtx.createMediaStreamSource(new MediaStream(s.getAudioTracks()));
        src.connect(dest);
      });
      dest.stream.getAudioTracks().forEach((t) => composed.addTrack(t));
      compositionCleanupRef.current = () => {
        cancelAnimationFrame(raf);
        audioCtx.close().catch(() => {});
      };
    } else {
      compositionCleanupRef.current = () => cancelAnimationFrame(raf);
    }

    return composed;
  };

  // Prepare media streams for the pre-flight checklist WITHOUT starting
  // MediaRecorder or the elapsed timer. The actual recording is started by
  // `beginRecording()` after the user passes pre-flight, so the saved video
  // contains only the authoring session (not the setup screens).
  const prepare = useCallback(async () => {
    setError(null);
    setState("requesting");
    try {
      let webcam: MediaStream;
      try {
        webcam = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: microphoneConstraints,
        });
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : "getUserMedia failed";
        logMicCaptureError(msg);
        throw err;
      }

      let expectedMonitorCount = 1;
      const nav = navigator as Navigator & {
        permissions?: { query: (q: { name: string }) => Promise<{ state: string }> };
      };
      const win = window as Window & {
        getScreenDetails?: () => Promise<{ screens: unknown[] }>;
      };
      if (typeof win.getScreenDetails === "function") {
        try {
          try {
            await nav.permissions?.query({ name: "window-management" });
          } catch {
            /* permission name may be unknown — fall through */
          }
          const details = await win.getScreenDetails();
          if (Array.isArray(details?.screens) && details.screens.length > 0) {
            expectedMonitorCount = details.screens.length;
          }
        } catch {
          expectedMonitorCount = 1;
        }
      }

      const monitorStreams: MediaStream[] = [];
      monitorStreams.push(await captureMonitor());

      while (monitorStreams.length < expectedMonitorCount) {
        const remaining = expectedMonitorCount - monitorStreams.length;
        const proceed = window.confirm(
          `Bio Mark detected ${expectedMonitorCount} monitors connected to this ` +
            `computer and ${monitorStreams.length} ${monitorStreams.length === 1 ? "has" : "have"} been shared so far. ` +
            `Please share the remaining ${remaining} monitor${remaining > 1 ? "s" : ""} ` +
            "to begin recording. Click OK to pick the next monitor, or Cancel " +
            "to abort the session.",
        );
        if (!proceed) {
          throw new Error(
            `All ${expectedMonitorCount} connected monitors must be shared before recording can begin.`,
          );
        }
        try {
          monitorStreams.push(await captureMonitor());
        } catch {
          throw new Error(
            `All ${expectedMonitorCount} connected monitors must be shared before recording can begin.`,
          );
        }
      }

      // Re-open the microphone after display capture (some OS audio stacks
      // re-route inputs when entire screens are shared).
      try {
        const refreshedMic = await navigator.mediaDevices.getUserMedia({
          audio: microphoneConstraints,
        });
        webcam.getAudioTracks().forEach((t) => t.stop());
        webcam = new MediaStream([
          ...webcam.getVideoTracks(),
          ...refreshedMic.getAudioTracks(),
        ]);
      } catch (err) {
        logMicCaptureError(
          err instanceof Error
            ? `mic refresh failed (${err.name}: ${err.message}) — keeping original track`
            : "mic refresh failed — keeping original track",
        );
      }

      screenSourceStreamsRef.current = monitorStreams;
      const screen = composeScreens(monitorStreams);

      screenStreamRef.current = screen;
      webcamStreamRef.current = webcam;

      webcam.getAudioTracks().forEach((t) => {
        t.onmute = () => logMicCaptureError(`mic track muted by system (${t.label || "default"})`);
        t.onended = () => logMicCaptureError(`mic track ended unexpectedly (${t.label || "default"})`);
      });

      setState("idle");
      return { screenStream: screen, webcamStream: webcam };
    } catch (e) {
      cleanup();
      const msg = e instanceof Error ? e.message : "Could not prepare recording.";
      setError(msg);
      setState("error");
      throw e;
    }
  }, [cleanup]);

  // Start the actual recording. Must be called after `prepare()` resolved and
  // pre-flight passed. Only from this point on are bytes captured to disk.
  const beginRecording = useCallback(() => {
    const screen = screenStreamRef.current;
    const webcam = webcamStreamRef.current;
    if (!screen || !webcam) {
      throw new Error("Media not prepared — call prepare() first.");
    }

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";

    screenChunksRef.current = [];
    webcamChunksRef.current = [];

    const screenRec = new MediaRecorder(screen, { mimeType: mime });
    const webcamRec = new MediaRecorder(webcam, { mimeType: mime });

    screenRec.ondataavailable = (e) => e.data.size && screenChunksRef.current.push(e.data);
    webcamRec.ondataavailable = (e) => e.data.size && webcamChunksRef.current.push(e.data);

    screenSourceStreamsRef.current.forEach((s) => {
      s.getVideoTracks()[0].onended = () => {
        if (screenRec.state !== "inactive") screenRec.stop();
        if (webcamRec.state !== "inactive") webcamRec.stop();
      };
    });

    screenRecorderRef.current = screenRec;
    webcamRecorderRef.current = webcamRec;

    screenRec.start(1000);
    webcamRec.start(1000);

    accumulatedRef.current = 0;
    runStartedAtRef.current = Date.now();
    setElapsed(0);
    tickRef.current = window.setInterval(() => {
      setElapsed(Math.floor(currentElapsedMs() / 1000));
    }, 500);

    setState("recording");
  }, []);

  const pause = useCallback(() => {
    const s = screenRecorderRef.current;
    const w = webcamRecorderRef.current;
    if (!s || !w || s.state !== "recording") return;
    s.pause();
    w.pause();
    accumulatedRef.current += Date.now() - runStartedAtRef.current;
    runStartedAtRef.current = 0;
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    const s = screenRecorderRef.current;
    const w = webcamRecorderRef.current;
    if (!s || !w || s.state !== "paused") return;
    s.resume();
    w.resume();
    runStartedAtRef.current = Date.now();
    setState("recording");
  }, []);

  const stop = useCallback((): Promise<RecordingResult> => {
    return new Promise((resolve, reject) => {
      const screenRec = screenRecorderRef.current;
      const webcamRec = webcamRecorderRef.current;
      if (!screenRec || !webcamRec) {
        reject(new Error("Recorder not active"));
        return;
      }
      const totalMs = currentElapsedMs();
      const duration = Math.max(1, Math.floor(totalMs / 1000));
      let pending = 2;
      const done = () => {
        pending -= 1;
        if (pending === 0) {
          const screenBlob = new Blob(screenChunksRef.current, { type: "video/webm" });
          const webcamBlob = new Blob(webcamChunksRef.current, { type: "video/webm" });
          cleanup();
          accumulatedRef.current = 0;
          runStartedAtRef.current = 0;
          setState("stopped");
          resolve({ screenBlob, webcamBlob, durationSeconds: duration });
        }
      };
      screenRec.onstop = done;
      webcamRec.onstop = done;
      if (screenRec.state !== "inactive") screenRec.stop();
      else done();
      if (webcamRec.state !== "inactive") webcamRec.stop();
      else done();
    });
  }, [cleanup]);

  return {
    state,
    error,
    elapsed,
    prepare,
    beginRecording,
    pause,
    resume,
    stop,
    screenStream: screenStreamRef.current,
    webcamStream: webcamStreamRef.current,
  };
}
