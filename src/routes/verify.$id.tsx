import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { verifyCertificate } from "@/lib/certificates.functions";
import { Check, ShieldCheck, ShieldX, X } from "lucide-react";

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

      <p className="mt-10 text-xs text-muted-foreground">
        Recordings are kept private and are never exposed by the public registry.
      </p>
    </article>
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
