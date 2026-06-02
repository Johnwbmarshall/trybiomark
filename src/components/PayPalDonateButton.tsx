import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Heart, ExternalLink } from "lucide-react";
import { getPaypalClientId } from "@/lib/paypal.functions";

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: {
        style?: { shape?: string; color?: string; layout?: string; label?: string };
      }) => { render: (el: HTMLElement) => Promise<void> };
    };
  }
}

export function PayPalDonateButton() {
  const fetchClientId = useServerFn(getPaypalClientId);
  const { data } = useQuery({
    queryKey: ["paypal-client-id"],
    queryFn: () => fetchClientId(),
    staleTime: Infinity,
  });
  const clientId = data?.clientId ?? null;

  const containerRef = useRef<HTMLDivElement>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    if (window.paypal) {
      setSdkReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId,
    )}&currency=CAD&components=buttons&intent=capture`;
    script.async = true;
    script.onload = () => setSdkReady(true);
    script.onerror = () => setLoadError("Failed to load PayPal.");
    document.body.appendChild(script);
  }, [clientId]);

  useEffect(() => {
    if (!sdkReady || !containerRef.current || !window.paypal) return;
    containerRef.current.innerHTML = "";
    window.paypal
      .Buttons({
        style: { shape: "pill", color: "gold", layout: "horizontal", label: "donate" },
      })
      .render(containerRef.current)
      .catch(() => setLoadError("Failed to render PayPal button."));
  }, [sdkReady]);

  if (!clientId) {
    return (
      <a
        href="https://www.paypal.com/donate"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-md bg-[#0070ba] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
      >
        <Heart className="h-4 w-4" />
        Donate with PayPal
        <ExternalLink className="h-3.5 w-3.5 opacity-70" />
      </a>
    );
  }

  if (loadError) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }

  return <div ref={containerRef} className="min-h-[45px] w-full max-w-[300px]" />;
}
