import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listMyCertificates } from "@/lib/certificates.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [{ title: "My Certificates — Bio Mark" }],
  }),
  component: Dashboard,
});

function Dashboard() {
  const fn = useServerFn(listMyCertificates);
  const { data, isLoading } = useQuery({
    queryKey: ["my-certificates"],
    queryFn: () => fn(),
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">My Certificates</h1>
        <Link
          to="/record"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          New session
        </Link>
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="p-8 text-muted-foreground">Loading…</div>
        ) : !data?.certificates.length ? (
          <div className="p-12 text-center">
            <p className="text-muted-foreground">No certificates yet.</p>
            <Link
              to="/record"
              className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
            >
              Record your first session
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {data.certificates.map((c) => (
              <li key={c.certificate_id} className="flex items-center justify-between p-5">
                <div>
                  <div className="font-display text-xl">{c.project_name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleString()} · {formatDuration(c.duration_seconds)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <code className="rounded bg-secondary px-2 py-1 font-mono text-xs">
                    {c.certificate_id}
                  </code>
                  <Link
                    to="/verify/$id"
                    params={{ id: c.certificate_id }}
                    className="text-sm text-gold hover:underline"
                  >
                    View →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function formatDuration(s: number) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}
