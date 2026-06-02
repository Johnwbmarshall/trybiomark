import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

interface Props {
  webcamStream: MediaStream | null;
  audioLevel: number;
}

type PermState = "granted" | "denied" | "prompt" | "unknown";

interface CaptureError {
  at: number;
  message: string;
}

// Module-level error log so capture errors from anywhere in the app can be
// surfaced here. Hooks register listeners; the recorder hook can call
// `logMicCaptureError` to push entries.
const errorLog: CaptureError[] = [];
const listeners = new Set<() => void>();

export function logMicCaptureError(message: string) {
  errorLog.unshift({ at: Date.now(), message });
  if (errorLog.length > 10) errorLog.length = 10;
  listeners.forEach((l) => l());
}

function useMicErrors(): CaptureError[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return errorLog.slice();
}

export function MicTroubleshootPanel({ webcamStream, audioLevel }: Props) {
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<PermState>("unknown");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const errors = useMicErrors();

  const refresh = async () => {
    try {
      const nav = navigator as Navigator & {
        permissions?: { query: (q: { name: PermissionName }) => Promise<PermissionStatus> };
      };
      if (nav.permissions?.query) {
        try {
          const status = await nav.permissions.query({ name: "microphone" as PermissionName });
          setPermission(status.state as PermState);
          status.onchange = () => setPermission(status.state as PermState);
        } catch {
          setPermission("unknown");
        }
      }
    } catch {
      setPermission("unknown");
    }
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
    } catch {
      setDevices([]);
    }
  };

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, []);

  const track = webcamStream?.getAudioTracks?.()[0] ?? null;
  const settings = track?.getSettings?.() ?? {};
  const constraints = track?.getConstraints?.() ?? {};
  const muted = track ? track.muted : null;
  const enabled = track ? track.enabled : null;
  const live = track ? track.readyState === "live" : null;
  const activeDevice = devices.find((d) => d.deviceId === settings.deviceId);

  const permColor =
    permission === "granted"
      ? "text-gold"
      : permission === "denied"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <div className="mt-3 rounded-md border border-border bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary/40"
      >
        <span className="inline-flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Microphone troubleshooting
        </span>
        <span className={`inline-flex items-center gap-1 ${permColor}`}>
          {errors.length > 0 && <AlertTriangle className="h-3 w-3 text-destructive" />}
          {permission}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3 text-xs">
          <Row label="Permission">
            <span className={permColor}>{permission}</span>
            <button
              onClick={refresh}
              className="ml-2 inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] hover:bg-secondary"
            >
              <RefreshCw className="h-2.5 w-2.5" /> Refresh
            </button>
          </Row>

          <Row label="Active source">
            <span className="text-foreground">
              {track?.label || activeDevice?.label || "—"}
            </span>
          </Row>

          <Row label="Track state">
            <span>
              {live === null
                ? "no track"
                : `${live ? "live" : "ended"} · ${enabled ? "enabled" : "disabled"} · ${
                    muted ? "muted" : "unmuted"
                  }`}
            </span>
          </Row>

          <Row label="Sample rate">
            <span>{settings.sampleRate ? `${settings.sampleRate} Hz` : "—"}</span>
          </Row>

          <Row label="Processing">
            <span>
              {[
                settings.echoCancellation && "EC",
                settings.noiseSuppression && "NS",
                settings.autoGainControl && "AGC",
              ]
                .filter(Boolean)
                .join(" · ") || "off"}
            </span>
          </Row>

          <Row label="Live level">
            <span>{(audioLevel * 100).toFixed(0)}%</span>
          </Row>

          <div>
            <div className="mb-1 text-muted-foreground">
              Available inputs ({devices.length})
            </div>
            <ul className="space-y-0.5">
              {devices.length === 0 && <li className="text-muted-foreground">None detected.</li>}
              {devices.map((d) => (
                <li
                  key={d.deviceId}
                  className={
                    d.deviceId === settings.deviceId
                      ? "text-gold"
                      : "text-muted-foreground"
                  }
                >
                  • {d.label || "(unnamed input)"}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-1 text-muted-foreground">
              Recent capture errors ({errors.length})
            </div>
            {errors.length === 0 ? (
              <div className="text-muted-foreground">None.</div>
            ) : (
              <ul className="space-y-0.5">
                {errors.map((e, i) => (
                  <li key={i} className="text-destructive">
                    {new Date(e.at).toLocaleTimeString()} — {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {constraints && Object.keys(constraints).length > 0 && (
            <details className="text-muted-foreground">
              <summary className="cursor-pointer">Applied constraints</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-secondary/40 p-2 text-[10px]">
                {JSON.stringify(constraints, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
