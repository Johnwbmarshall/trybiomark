import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  decideEvidenceRequest,
  getEvidenceRequest,
} from "@/lib/evidence.functions";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldX } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/evidence/$token")({
  head: () => ({
    meta: [
      { title: "Evidence request — Bio Mark" },
      {
        name: "robots",
        content: "noindex,nofollow",
      },
    ],
  }),
  component: EvidenceDecisionPage,
});

function EvidenceDecisionPage() {
  const { token } = Route.useParams();
  const getFn = useServerFn(getEvidenceRequest);
  const decideFn = useServerFn(decideEvidenceRequest);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["evidence-request", token],
    queryFn: () => getFn({ data: { token } }),
  });

  const [submitting, setSubmitting] = useState<null | "approved" | "denied">(
    null,
  );

  async function decide(decision: "approved" | "denied") {
    setSubmitting(decision);
    try {
      await decideFn({ data: { token, decision } });
      toast.success(
        decision === "approved"
          ? "Approved. The requester has been emailed download links."
          : "Denied. The requester has been notified.",
      );
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save decision.");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <Link
        to="/"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Home
      </Link>

      {isLoading ? (
        <div className="mt-10 rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">
          Loading request…
        </div>
      ) : !data?.found ? (
        <div className="mt-8 rounded-2xl border border-border bg-card p-10 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <ShieldX className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="mt-6 font-display text-3xl">Request not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This link is invalid or has been removed.
          </p>
        </div>
      ) : (
        <article className="mt-8 rounded-2xl border border-border bg-card p-10">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <ShieldCheck className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Evidence request
              </p>
              <h1 className="mt-1 font-display text-3xl">
                {data.request.projectName}
              </h1>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {data.request.certificateId}
              </p>
            </div>
          </div>

          <dl className="mt-8 grid gap-5 sm:grid-cols-2">
            <Field label="Requested by">
              <span>{data.request.requesterName}</span>
              <br />
              <span className="text-muted-foreground">
                {data.request.requesterEmail}
              </span>
            </Field>
            <Field label="Submitted">
              {new Date(data.request.createdAt).toLocaleString()}
            </Field>
          </dl>

          <div className="mt-6">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Reason
            </p>
            <p className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-4 text-sm">
              {data.request.requesterReason}
            </p>
          </div>

          <div className="mt-8 rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            Approving releases time-limited download links (7 days) for the
            original screen recording, webcam video, and PDF to the requester.
            Denying keeps all materials private.
          </div>

          {data.request.status !== "pending" ? (
            <div className="mt-8 rounded-lg border border-border p-4 text-center text-sm">
              This request has already been{" "}
              <strong>{data.request.status}</strong>.
            </div>
          ) : data.request.expired ? (
            <div className="mt-8 rounded-lg border border-border p-4 text-center text-sm text-muted-foreground">
              This request has expired.
            </div>
          ) : (
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                disabled={submitting !== null}
                onClick={() => decide("denied")}
              >
                {submitting === "denied" ? "Saving…" : "Deny request"}
              </Button>
              <Button
                disabled={submitting !== null}
                onClick={() => decide("approved")}
              >
                {submitting === "approved" ? "Saving…" : "Approve & release"}
              </Button>
            </div>
          )}
        </article>
      )}
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}
