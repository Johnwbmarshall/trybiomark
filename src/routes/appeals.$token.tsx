import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { decideAppeal, getAppeal } from "@/lib/appeals.functions";
import { Button } from "@/components/ui/button";
import { Check, ShieldCheck, ShieldX, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/appeals/$token")({
  head: () => ({
    meta: [
      { title: "Review appeal — Bio Mark" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AppealReviewPage,
});

function AppealReviewPage() {
  const { token } = Route.useParams();
  const getFn = useServerFn(getAppeal);
  const decideFn = useServerFn(decideAppeal);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["appeal", token],
    queryFn: () => getFn({ data: { token } }),
  });

  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState<null | "approved" | "denied">(
    null,
  );

  async function decide(decision: "approved" | "denied") {
    setSubmitting(decision);
    try {
      await decideFn({
        data: { token, decision, reviewerNotes: notes || undefined },
      });
      toast.success(
        decision === "approved"
          ? "Approved. A certificate has been issued and the user emailed."
          : "Upheld. The user has been notified.",
      );
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit decision.");
    } finally {
      setSubmitting(null);
    }
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-muted-foreground">Loading appeal…</p>
      </main>
    );
  }

  if (!data || data.found === false) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-4xl">Appeal not found</h1>
        <p className="mt-3 text-muted-foreground">
          This link is invalid or has expired.
        </p>
        <Link to="/" className="mt-6 inline-block text-primary underline">
          Back to Bio Mark
        </Link>
      </main>
    );
  }

  const a = data.appeal;
  const decided = a.status !== "pending";

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-sm uppercase tracking-widest text-muted-foreground">
        Appeal review
      </p>
      <h1 className="mt-2 font-display text-4xl">{a.projectName}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Submitted by {a.userEmail ?? "unknown"} ·{" "}
        {new Date(a.createdAt).toLocaleString()} · duration {a.durationSeconds}s
      </p>

      {decided ? (
        <div className="mt-6 rounded-lg border border-border bg-card p-4">
          <p className="font-medium">
            Already {a.status}
            {a.certificateId ? ` — ${a.certificateId}` : ""}
          </p>
          {a.reviewerNotes ? (
            <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
              {a.reviewerNotes}
            </p>
          ) : null}
        </div>
      ) : a.expired ? (
        <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-destructive">
          This appeal has expired.
        </div>
      ) : null}

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="font-display text-2xl">Screen recording</h2>
          {a.screenUrl ? (
            <video
              src={a.screenUrl}
              controls
              className="mt-3 w-full rounded-lg border border-border"
            />
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Not available.</p>
          )}
        </div>
        <div>
          <h2 className="font-display text-2xl">Webcam recording</h2>
          {a.webcamUrl ? (
            <video
              src={a.webcamUrl}
              controls
              className="mt-3 w-full rounded-lg border border-border"
            />
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Not available.</p>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl">Original PDF</h2>
        {a.pdfUrl ? (
          <a
            href={a.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-primary underline"
          >
            Open original PDF
          </a>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Not available.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl">Gemini's reasoning</h2>
        {a.summary ? (
          <p className="mt-2 text-sm rounded-md bg-card border border-border p-3">
            {a.summary}
          </p>
        ) : null}
        <ul className="mt-4 space-y-3">
          {a.checks.map((c) => (
            <li
              key={c.key}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                {c.passed ? (
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                ) : (
                  <X className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                )}
                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{c.label}</p>
                    <span className="text-xs uppercase tracking-widest text-muted-foreground">
                      {c.confidence} confidence
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{c.reason}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {a.userNote ? (
        <section className="mt-8">
          <h2 className="font-display text-2xl">User's note</h2>
          <p className="mt-2 text-sm rounded-md bg-card border border-border p-3 whitespace-pre-wrap">
            {a.userNote}
          </p>
        </section>
      ) : null}

      {!decided && !a.expired && (
        <section className="mt-10 rounded-xl border border-border bg-card p-6">
          <h2 className="font-display text-2xl">Your decision</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Reversing the decision issues a certificate to the user. Upholding
            the decision sends a notice with no certificate.
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes for the user (shown in their email)…"
            className="mt-4 w-full min-h-[100px] rounded-md border border-input bg-background p-3 text-sm"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              onClick={() => decide("approved")}
              disabled={submitting !== null}
              className="gap-2"
            >
              <ShieldCheck className="h-4 w-4" />
              {submitting === "approved"
                ? "Reversing…"
                : "Reverse — issue certificate"}
            </Button>
            <Button
              variant="outline"
              onClick={() => decide("denied")}
              disabled={submitting !== null}
              className="gap-2"
            >
              <ShieldX className="h-4 w-4" />
              {submitting === "denied" ? "Upholding…" : "Uphold denial"}
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
