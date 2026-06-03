// Browser-only helpers for extracting frames from video blobs and pages from PDFs.
// All return JPEG data URLs ready for multimodal AI requests.

const JPEG_QUALITY = 0.7;

export interface TimestampedFrame {
  dataUrl: string;
  timestampSec: number;
}

async function loadVideo(blob: Blob): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(blob);
    const cleanup = () => URL.revokeObjectURL(video.src);
    video.onloadedmetadata = () => {
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

async function ensureDuration(video: HTMLVideoElement): Promise<number> {
  if (!isFinite(video.duration) || video.duration <= 0) {
    try {
      await video.play();
      video.pause();
    } catch {
      /* ignore */
    }
  }
  return isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
}

// Sampling strategy:
// - Short recordings (≤60s): evenly spaced across the whole clip with
//   guaranteed frames at the very start and very end. Sparse end-weighting
//   is counterproductive when there isn't much footage to begin with.
// - Longer recordings: ~50% evenly spaced, ~50% packed into the final third
//   where the finished document is most likely visible. First and last
//   timestamps are always included.
function endWeightedTimestamps(duration: number, count: number): number[] {
  if (count <= 1) return [duration * 0.5];

  const epsilon = Math.min(0.25, duration * 0.02);
  const first = epsilon;
  const last = Math.max(0, duration - epsilon);

  if (duration <= 60) {
    const out: number[] = [first];
    const inner = count - 2;
    for (let i = 1; i <= inner; i++) {
      out.push((i / (inner + 1)) * duration);
    }
    out.push(last);
    return Array.from(new Set(out.map((t) => Math.round(t * 100) / 100))).sort(
      (a, b) => a - b,
    );
  }

  const evenCount = Math.max(2, Math.round(count * 0.5));
  const endCount = Math.max(0, count - evenCount - 2);
  const out: number[] = [first];
  for (let i = 0; i < evenCount; i++) {
    out.push(((i + 0.5) / evenCount) * duration);
  }
  if (endCount > 0) {
    const endStart = duration * (2 / 3);
    const endSpan = Math.max(0, duration - endStart - epsilon);
    for (let i = 0; i < endCount; i++) {
      out.push(endStart + ((i + 0.5) / endCount) * endSpan);
    }
  }
  out.push(last);
  return Array.from(new Set(out.map((t) => Math.round(t * 100) / 100))).sort(
    (a, b) => a - b,
  );
}

export async function extractVideoFramesWithTimestamps(
  blob: Blob,
  count: number,
  maxWidth: number,
  options: { endWeighted?: boolean } = {},
): Promise<TimestampedFrame[]> {
  const video = await loadVideo(blob);
  const duration = await ensureDuration(video);
  const canvas = document.createElement("canvas");
  const out: TimestampedFrame[] = [];

  const stamps = options.endWeighted
    ? endWeightedTimestamps(duration, count)
    : Array.from(
        { length: count },
        (_, i) => ((i + 0.5) / count) * duration,
      );

  for (const t of stamps) {
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
    out.push({
      dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
      timestampSec: Math.max(0, Math.min(duration, t)),
    });
  }
  URL.revokeObjectURL(video.src);
  return out;
}

// Back-compat: returns just data URLs (used elsewhere if needed).
export async function extractVideoFrames(
  blob: Blob,
  count: number,
  maxWidth: number,
): Promise<string[]> {
  const frames = await extractVideoFramesWithTimestamps(blob, count, maxWidth);
  return frames.map((f) => f.dataUrl);
}

export async function extractPdfPageImages(
  file: File | Blob,
  maxPages: number,
  maxWidth: number,
): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
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
