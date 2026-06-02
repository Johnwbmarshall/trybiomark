import { useEffect, useRef, useState } from "react";
import { Heart, ExternalLink } from "lucide-react";

const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID;

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: {
        style?: {
          shape?: string;
          color?: string;
          layout?: string;
          label?: string;
        };
        createOrder?: (data: unknown, actions: { order: { create: (details: unknown) => Promise<string> } }) => Promise<string>;
        onApprove?: (data: unknown, actions: { order: { capture: () => Promise<unknown> } }) => Promise<void>;
      }) => { render: (el: HTMLElement) => Promise<void> };
    };
  }
}

export function PayPalDonateButton() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!PAYPAL_CLIENT_ID) return;

    if (window.paypal) {
      setSdkReady(true);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(PAYPAL_CLIENT_ID)}&currency=CAD`;
    script.async = true;
    script.onload = () => setSdkReady(true);
    script.onerror = () => setLoadError("Failed to load PayPal.");
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  useEffect(() => {
    if (!sdkReady || !containerRef.current || !window.paypal) return;

    const buttons = window.paypal.Buttons({
      style: {
        shape: "pill",
        color: "gold",
        layout: "horizontal",
        label: "donate",
      },
    });

    buttons.render(containerRef.current).catch(() => {
      setLoadError("Failed to render PayPal button.");
    });
  }, [sdkReady]);

  if (!PAYPAL_CLIENT_ID) {
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
    return (
      <p className="text-sm text-destructive">{loadError}</p>
    );
  }

  return <div ref={containerRef} className="min-h-[45px]" />;
}
