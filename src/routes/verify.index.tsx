import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Search } from "lucide-react";

export const Route = createFileRoute("/verify/")({
  head: () => ({
    meta: [
      { title: "Verify a Certificate — ProofOfHuman" },
      {
        name: "description",
        content: "Enter a ProofOfHuman certificate ID to verify a piece of human-made work.",
      },
      { property: "og:title", content: "Verify a Certificate — ProofOfHuman" },
      {
        property: "og:description",
        content: "Free public lookup for ProofOfHuman certificates of authenticity.",
      },
    ],
  }),
  component: VerifyIndex,
});

function VerifyIndex() {
  const [id, setId] = useState("");
  const navigate = useNavigate();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = id.trim().toUpperCase();
    if (!cleaned) return;
    navigate({ to: "/verify/$id", params: { id: cleaned } });
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <p className="text-xs uppercase tracking-widest text-gold">Public registry</p>
      <h1 className="mt-3 font-display text-5xl">Verify a Certificate</h1>
      <p className="mt-3 text-muted-foreground">
        Enter a certificate ID to confirm the work was created through a recorded human
        process.
      </p>

      <form onSubmit={submit} className="mx-auto mt-10 flex max-w-lg gap-2">
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="CERT-XXXX-XX"
          className="flex-1 rounded-md border border-input bg-card px-4 py-3 font-mono uppercase tracking-wider outline-none focus:ring-2 focus:ring-ring"
        />
        <button className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Search className="h-4 w-4" />
          Verify
        </button>
      </form>
    </main>
  );
}
