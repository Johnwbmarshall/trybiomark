import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording" | "stopped" | "error";

export interface RecordingResult {
  screenBlob: Blob;
  webcamBlob: Blob;
  durationSeconds: number;
}

export function useMediaRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const webcamRecorderRef = useRef<MediaRecorder | null>(null);
  const screenChunksRef = useRef<Blob[]>([]);
  const webcamChunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    webcamStreamRef.current = null;
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    setState("requesting");
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      const webcam = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true,
      });
      screenStreamRef.current = screen;
      webcamStreamRef.current = webcam;

      const mime =
        MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
          ? "video/webm;codecs=vp9,opus"
          : "video/webm";

      screenChunksRef.current = [];
      webcamChunksRef.current = [];

      const screenRec = new MediaRecorder(screen, { mimeType: mime });
      const webcamRec = new MediaRecorder(webcam, { mimeType: mime });

      screenRec.ondataavailable = (e) => e.data.size && screenChunksRef.current.push(e.data);
      webcamRec.ondataavailable = (e) => e.data.size && webcamChunksRef.current.push(e.data);

      // If user clicks the browser's native "Stop sharing" button, end the session.
      screen.getVideoTracks()[0].onended = () => {
        if (screenRec.state === "recording") screenRec.stop();
        if (webcamRec.state === "recording") webcamRec.stop();
      };

      screenRecorderRef.current = screenRec;
      webcamRecorderRef.current = webcamRec;

      screenRec.start(1000);
      webcamRec.start(1000);

      startedAtRef.current = Date.now();
      setElapsed(0);
      tickRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 500);

      setState("recording");
      return { screenStream: screen, webcamStream: webcam };
    } catch (e) {
      cleanup();
      const msg = e instanceof Error ? e.message : "Could not start recording.";
      setError(msg);
      setState("error");
      throw e;
    }
  }, [cleanup]);

  const stop = useCallback((): Promise<RecordingResult> => {
    return new Promise((resolve, reject) => {
      const screenRec = screenRecorderRef.current;
      const webcamRec = webcamRecorderRef.current;
      if (!screenRec || !webcamRec) {
        reject(new Error("Recorder not active"));
        return;
      }
      const duration = Math.max(1, Math.floor((Date.now() - startedAtRef.current) / 1000));
      let pending = 2;
      const done = () => {
        pending -= 1;
        if (pending === 0) {
          const screenBlob = new Blob(screenChunksRef.current, { type: "video/webm" });
          const webcamBlob = new Blob(webcamChunksRef.current, { type: "video/webm" });
          cleanup();
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
    start,
    stop,
    screenStream: screenStreamRef.current,
    webcamStream: webcamStreamRef.current,
  };
}
