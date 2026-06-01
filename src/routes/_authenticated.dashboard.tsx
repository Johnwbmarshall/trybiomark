import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listMyCertificates } from "@/lib/certificates.functions";
import { listMyDrafts, deleteDraft } from "@/lib/drafts.functions";
import { Trash2, FilePlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [{ title: "My Certificates — Bio Mark" }],
  }),
  component: Dashboard,
});

function Dashboard() {
  const certsFn = useServerFn(listMyCertificates);
  const draftsFn = useServerFn(listMyDrafts);
  const delDraftFn = useServerFn(deleteDraft);
  const qc = useQueryClient();

  const certs = useQuery({
    queryKey: ["my-certificates"],
    queryFn: () => certsFn(),
  });
  const drafts = useQuery({
    queryKey: ["my-drafts"],
    queryFn: () => draftsFn(),
  });

  const del = useMutation({
    mutationFn: (id: string) => delDraftFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-drafts"] }),
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

      {drafts.data?.drafts.length ? (
        <section className="mt-8">
          <h2 className="text-sm uppercase tracking-widest text-gold">Drafts</h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border">
              {drafts.data.drafts.map((d) => (
                <li key={d.id} className="flex items-center justify-between p-5">
                  <div>
                    <div className="font-display text-xl">{d.project_name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Saved {new Date(d.created_at).toLocaleString()} · {formatDuration(d.duration_seconds)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link
                      to="/record"
                      search={{ draft: d.id }}
                      className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
                    >
                      <FilePlus className="h-3.5 w-3.5" />
                      Attach PDF & submit
                    </Link>
                    <button
                      onClick={() => {
                        if (confirm("Delete this draft? The recording will be removed.")) {
                          del.mutate(d.id);
                        }
                      }}
                      className="rounded-md border border-border bg-background p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
                      aria-label="Delete draft"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        {drafts.data?.drafts.length ? (
          <h2 className="text-sm uppercase tracking-widest text-muted-foreground">Issued</h2>
        ) : null}
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
          {certs.isLoading ? (
            <div className="p-8 text-muted-foreground">Loading…</div>
          ) : !certs.data?.certificates.length ? (
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
              {certs.data.certificates.map((c) => (
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
      </section>
    </main>
  );
}

function formatDuration(s: number) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}
