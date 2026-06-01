// Browser-only helpers for extracting frames from video blobs and pages from PDFs.
// All return JPEG data URLs ready for multimodal AI requests.

const JPEG_QUALITY = 0.7;

async function loadVideo(blob: Blob): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(blob);
    const cleanup = () => URL.revokeObjectURL(video.src);
    video.onloadedmetadata = () => {
      // Some browsers won't seek without a play()/pause() priming.
      video.currentTime = 0;
      resolve(video);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Could not load video for frame extraction"));
    };
  });
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    const onError = () => {
      video.removeEventListener("error", onError);
      reject(new Error("Seek failed"));
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = Math.max(0, Math.min(video.duration - 0.05, t));
  });
}

export async function extractVideoFrames(
  blob: Blob,
  count: number,
  maxWidth: number,
): Promise<string[]> {
  const video = await loadVideo(blob);
  // Wait until metadata is fully ready (duration available).
  if (!isFinite(video.duration) || video.duration <= 0) {
    // Force a tiny play to populate duration on browsers that need it.
    try {
      await video.play();
      video.pause();
    } catch {
      /* ignore */
    }
  }
  const duration = isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
  const canvas = document.createElement("canvas");
  const frames: string[] = [];

  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) / count) * duration;
    try {
      await seek(video, t);
    } catch {
      continue;
    }
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 360;
    const scale = Math.min(1, maxWidth / vw);
    canvas.width = Math.max(64, Math.round(vw * scale));
    canvas.height = Math.max(64, Math.round(vh * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
  }
  URL.revokeObjectURL(video.src);
  return frames;
}

export async function extractPdfPageImages(
  file: File | Blob,
  maxPages: number,
  maxWidth: number,
): Promise<string[]> {
  // Lazy import — pdfjs is heavy and only needed during verification.
  const pdfjs = await import("pdfjs-dist");
  // Inline worker to avoid worker-url configuration headaches.
  const workerMod = await import(
    /* @vite-ignore */ "pdfjs-dist/build/pdf.worker.mjs?url"
  );
  pdfjs.GlobalWorkerOptions.workerSrc = (workerMod as { default: string }).default;

  const ab = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: ab }).promise;
  const pages = Math.min(pdf.numPages, maxPages);
  const out: string[] = [];

  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, maxWidth / viewport.width);
    const v = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(v.width);
    canvas.height = Math.ceil(v.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport: v, canvas }).promise;
    out.push(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
  }
  return out;
}
