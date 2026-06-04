import { useEffect } from "react";

interface Props {
  flashHex: string;
  pose: string;
  /** Total time the overlay stays up. */
  durationMs?: number;
  /** When (ms from mount) to snap the webcam frame. Should be before durationMs. */
  snapAtMs?: number;
  onSnap: () => void;
  onDone: () => void;
}

export function LivenessOverlay({
  flashHex,
  pose,
  durationMs = 2200,
  snapAtMs = 1100,
  onSnap,
  onDone,
}: Props) {
  useEffect(() => {
    const snapT = window.setTimeout(onSnap, snapAtMs);
    const doneT = window.setTimeout(onDone, durationMs);
    return () => {
      window.clearTimeout(snapT);
      window.clearTimeout(doneT);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ backgroundColor: flashHex }}
    >
      <div className="rounded-2xl bg-black/70 px-10 py-8 text-center text-white shadow-2xl backdrop-blur">
        <p className="text-xs uppercase tracking-[0.3em] opacity-80">
          Liveness check
        </p>
        <p className="mt-3 text-4xl font-semibold">{pose}</p>
        <p className="mt-3 text-sm opacity-80">
          Hold the pose for a second. Don't cover the screen.
        </p>
      </div>
    </div>
  );
}
