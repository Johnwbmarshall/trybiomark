import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Video, Award, Search, Heart, HandHeart } from "lucide-react";
import { PayPalDonateButton } from "@/components/PayPalDonateButton";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bio Mark — Certify your work as human-made" },
      {
        name: "description",
        content:
          "Record your creative process via screen + webcam and receive a verifiable Certificate of Authenticity. Anyone can verify the ID for free.",
      },
      { property: "og:title", content: "Bio Mark" },
      {
        property: "og:description",
        content: "Verifiable Certificates of Authenticity for human-made digital work.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <main>
      <section className="mx-auto max-w-5xl px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2 text-sm uppercase tracking-widest text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-gold" />
          Human-process verification registry
        </div>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/5 px-4 py-1.5 text-xs font-medium text-gold">
          <HandHeart className="h-3.5 w-3.5" />
          100% non-profit — all proceeds support human writing & creative initiatives
        </div>
        <h1 className="mt-8 font-display text-6xl leading-[1.05] md:text-7xl">
          Prove your work
          <br />
          <span className="text-gold italic">was made by a human.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          Record your screen and webcam while you create. Receive a signed Certificate of
          Authenticity with a public ID anyone can verify — <span className="font-medium text-foreground">completely free</span>.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/record"
            className="rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Start a session
          </Link>
          <Link
            to="/verify"
            className="rounded-md border border-border bg-card px-6 py-3 text-sm font-medium hover:bg-secondary"
          >
            Verify a certificate
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
          <Step
            icon={<Video className="h-5 w-5" />}
            n="01"
            title="Record"
            body="Capture your screen and webcam simultaneously while you work."
          />
          <Step
            icon={<Award className="h-5 w-5" />}
            n="02"
            title="Certify"
            body="A unique CERT-XXXX-XX ID is generated and signed into the registry."
          />
          <Step
            icon={<Search className="h-5 w-5" />}
            n="03"
            title="Verify"
            body="Anyone can confirm authenticity by entering the ID — no account needed."
          />
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-16 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-gold" />
        <h2 className="mt-4 font-display text-3xl">Your footage is yours.</h2>
        <p className="mt-3 text-muted-foreground">
          Recordings are stored privately. Only you can access them. The public registry only
          ever exposes the project name, date, and verified status.
        </p>
      </section>

      <section className="mx-auto max-w-xl px-6 pb-32 text-center">
        <div className="rounded-2xl border border-gold/20 bg-gold/5 p-8">
          <Heart className="mx-auto h-8 w-8 text-gold" />
          <h2 className="mt-4 font-display text-2xl">Support the mission</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Bio Mark is a fully non-profit initiative. Every donation goes directly toward
            supporting human writing, creative arts, and initiatives that protect authentic
            human expression in the digital age.
          </p>
          <div className="mt-6 flex justify-center">
            <PayPalDonateButton />
          </div>
        </div>
      </section>
    </main>
  );
}

function Step({
  icon,
  n,
  title,
  body,
}: {
  icon: React.ReactNode;
  n: string;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-card p-8">
      <div className="flex items-center justify-between text-muted-foreground">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-primary">
          {icon}
        </div>
        <span className="font-display text-2xl text-muted-foreground/60">{n}</span>
      </div>
      <h3 className="mt-6 font-display text-2xl">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
