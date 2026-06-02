import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { verifyCertificate } from "@/lib/certificates.functions";
import { requestEvidence } from "@/lib/evidence.functions";
import { Check, ShieldCheck, ShieldX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/verify/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Verify ${params.id} — Bio Mark` },
      {
        name: "description",
        content: `Public verification page for certificate ${params.id}.`,
      },
    ],
  }),
  component: VerifyResult,
});

function VerifyResult() {
  const { id } = Route.useParams();
  const fn = useServerFn(verifyCertificate);
  const { data, isLoading } = useQuery({
    queryKey: ["verify", id],
    queryFn: () => fn({ data: { certificateId: id } }),
  });

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <Link to="/verify" className="text-sm text-muted-foreground hover:text-foreground">
        ← Verify another
      </Link>

      {isLoading ? (
        <div className="mt-10 rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">
          Checking the registry…
        </div>
      ) : data?.found ? (
        <Found cert={data.certificate} />
      ) : (
        <NotFound id={id} />
      )}
    </main>
  );
}

function Found({
  cert,
}: {
  cert: {
    certificateId: string;
    projectName: string;
    createdAt: string;
    verificationStatus: string;
    durationSeconds: number;
    checks: Array<{
      key: string;
      label: string;
      passed: boolean;
      confidence: "low" | "medium" | "high";
      reason: string;
    }>;
    summary: string;
  };
}) {
  const date = new Date(cert.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <article className="certificate-paper mt-8 rounded-2xl p-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-widest text-gold">Verified · Authentic</p>
          <h1 className="mt-3 font-display text-4xl">{cert.projectName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Issued {date}</p>
        </div>
        <div className="relative shrink-0">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gold/20 ring-2 ring-gold">
            <ShieldCheck className="h-10 w-10 text-primary" />
          </div>
        </div>
      </div>

      <div className="mt-10 inline-flex items-center gap-2 rounded-full border border-gold bg-gold/10 px-4 py-2 text-sm font-medium text-primary">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold" />
        100% Human Process Confirmed
      </div>

      <dl className="mt-10 grid gap-6 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-widest text-muted-foreground">
            Certificate ID
          </dt>
          <dd className="mt-1 font-mono text-lg">{cert.certificateId}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-widest text-muted-foreground">
            Session length
          </dt>
          <dd className="mt-1 text-lg">{Math.max(1, Math.round(cert.durationSeconds / 60))} min</dd>
        </div>
      </dl>

      {cert.checks.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-2xl">Verification report</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Automated checks performed on the recorded session and submitted document.
          </p>
          <ul className="mt-6 space-y-4">
            {cert.checks.map((c, i) => (
              <li
                key={c.key}
                className="rounded-xl border border-border bg-card/50 p-4"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      c.passed
                        ? "bg-emerald-500/15 text-emerald-600"
                        : "bg-destructive/15 text-destructive"
                    }`}
                    aria-hidden
                  >
                    {c.passed ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">
                        {i + 1}. {c.label}
                      </p>
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {c.confidence} confidence
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{c.reason}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {cert.summary && (
            <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Summary. </span>
              {cert.summary}
            </div>
          )}
        </section>
      )}

      <RequestEvidence
        certificateId={cert.certificateId}
        projectName={cert.projectName}
      />

      <p className="mt-10 text-xs text-muted-foreground">
        Recordings are kept private and are never exposed by the public registry.
        To inspect the original evidence, send a request above — the owner
        decides whether to release it.
      </p>
    </article>
  );
}

function RequestEvidence({
  certificateId,
  projectName,
}: {
  certificateId: string;
  projectName: string;
}) {
  const fn = useServerFn(requestEvidence);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 10) {
      toast.error("Please provide a reason (at least 10 characters).");
      return;
    }
    setSubmitting(true);
    try {
      await fn({
        data: {
          certificateId,
          requesterName: name.trim(),
          requesterEmail: email.trim(),
          reason: reason.trim(),
        },
      });
      setDone(true);
      toast.success("Request sent. The owner has been notified by email.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not send request.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-12 rounded-xl border border-border bg-card/50 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Request the original evidence</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask the owner of {projectName} to release the original screen
            recording, webcam video, and PDF. They will be emailed and can
            approve or deny.
          </p>
        </div>
        {!open && !done ? (
          <Button onClick={() => setOpen(true)}>Request evidence</Button>
        ) : null}
      </div>

      {done ? (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4 text-sm">
          Your request has been sent. You'll receive an email at{" "}
          <strong>{email}</strong> once the owner responds.
        </div>
      ) : open ? (
        <form onSubmit={submit} className="mt-6 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ev-name">Your name</Label>
              <Input
                id="ev-name"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>
            <div>
              <Label htmlFor="ev-email">Your email</Label>
              <Input
                id="ev-email"
                type="email"
                required
                maxLength={255}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ev-reason">Reason for request</Label>
            <Textarea
              id="ev-reason"
              required
              minLength={10}
              maxLength={2000}
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why you'd like to see the original evidence."
            />
            <p className="mt-1 text-xs text-muted-foreground">
              The owner will see your name, email, and reason.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Sending…" : "Send request"}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <div className="mt-8 rounded-2xl border border-border bg-card p-10 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <ShieldX className="h-8 w-8 text-destructive" />
      </div>
      <h1 className="mt-6 font-display text-3xl">Not in the registry</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        No certificate found for <code className="font-mono">{id}</code>. Double-check the ID
        and try again.
      </p>
      <Link
        to="/verify"
        className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
      >
        Try another ID
      </Link>
    </div>
  );
}
