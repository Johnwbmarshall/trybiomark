import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { amIAdmin } from "@/lib/admin.functions";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl text-foreground">404</h1>
        <h2 className="mt-4 text-xl text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong. Try refreshing.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  auth: AuthState;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Bio Mark — Certify your work as human-made" },
      {
        name: "description",
        content:
          "Record your creative process via screen + webcam and receive a verifiable Certificate of Authenticity. Anyone can verify it for free.",
      },
      { name: "author", content: "Bio Mark" },
      { property: "og:title", content: "Bio Mark — Certify your work as human-made" },
      {
        property: "og:description",
        content: "Verifiable Certificates of Authenticity for human-made digital work.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Bio Mark — Certify your work as human-made" },
      { name: "description", content: "Records digital creation processes via webcam and screen recording to generate verifiable proof of human authorship." },
      { property: "og:description", content: "Records digital creation processes via webcam and screen recording to generate verifiable proof of human authorship." },
      { name: "twitter:description", content: "Records digital creation processes via webcam and screen recording to generate verifiable proof of human authorship." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/20eb62b2-dd68-4402-9ac4-0bfa2fcef03a/id-preview-070da14b--3af8b717-0412-4687-a1de-b7986e2d9fc8.lovable.app-1780347521876.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/20eb62b2-dd68-4402-9ac4-0bfa2fcef03a/id-preview-070da14b--3af8b717-0412-4687-a1de-b7986e2d9fc8.lovable.app-1780347521876.png" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthSync />
      <SiteHeader />
      {/* Required: nested routes render here. */}
      <Outlet />
    </QueryClientProvider>
  );
}

function AuthSync() {
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      router.invalidate();
      queryClient.invalidateQueries();
    });
    return () => subscription.unsubscribe();
  }, [router, queryClient]);
  return null;
}

function SiteHeader() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => setEmail(s?.user?.email ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <>
      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-gold" />
            <span className="font-display text-xl tracking-tight">Bio Mark</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link to="/verify" className="px-3 py-1.5 rounded hover:bg-secondary">
              Verify
            </Link>
            {email ? (
              <>
                <Link to="/record" className="px-3 py-1.5 rounded hover:bg-secondary">
                  Record
                </Link>
                <Link to="/dashboard" className="px-3 py-1.5 rounded hover:bg-secondary">
                  My Certificates
                </Link>
                <Link to="/profile" className="px-3 py-1.5 rounded hover:bg-secondary">
                  Profile
                </Link>
                <AdminNavLink />
                <button
                  onClick={signOut}
                  className="ml-2 px-3 py-1.5 rounded text-muted-foreground hover:bg-secondary"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="ml-2 px-4 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <SiteFooter />
    </>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex flex-col items-center justify-between gap-3 md:flex-row">
          <p className="text-xs text-muted-foreground">
            Bio Mark is a fully non-profit initiative. All proceeds support human writing & creative initiatives.
          </p>
          <p className="text-xs text-muted-foreground/60">
            &copy; {new Date().getFullYear()} Bio Mark
          </p>
        </div>
      </div>
    </footer>
  );
}
