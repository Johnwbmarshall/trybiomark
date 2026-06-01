import { Pause, Play, Square } from "lucide-react";

interface Props {
  elapsed: number;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function RecordingControls({ elapsed, paused, onPause, onResume, onStop }: Props) {
  const m = Math.floor(elapsed / 60)
    .toString()
    .padStart(2, "0");
  const s = (elapsed % 60).toString().padStart(2, "0");

  return (
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2.5 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2 pr-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              paused ? "bg-muted-foreground" : "animate-pulse bg-destructive"
            }`}
          />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            {paused ? "Paused" : "Recording"}
          </span>
        </div>
        <div className="font-mono text-lg tabular-nums">{m}:{s}</div>
        <div className="mx-2 h-6 w-px bg-border" />
        {paused ? (
          <button
            onClick={onResume}
            className="inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Resume
          </button>
        ) : (
          <button
            onClick={onPause}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-secondary"
          >
            <Pause className="h-3.5 w-3.5 fill-current" />
            Pause
          </button>
        )}
        <button
          onClick={onStop}
          className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90"
        >
          <Square className="h-3.5 w-3.5 fill-current" />
          Stop
        </button>
      </div>
    </div>
  );
}
