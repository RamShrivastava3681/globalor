import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { signIn, signUp } from "@/lib/api-client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ mode: z.enum(["signin", "signup"]).optional() }),
  component: AuthPage,
});

function AuthPage() {
  const { mode: initialMode } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const { user, refreshSession } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate({ to: "/app/dashboard" });
  }, [user, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        await signUp(email, password, companyName);
        toast.success("Account created.");
      } else {
        await signIn(email, password);
        toast.success("Welcome back.");
      }
      await refreshSession();
      navigate({ to: "/app/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-background md:grid-cols-2">
      {/* Left brand */}
      <div className="relative hidden border-r border-border bg-[radial-gradient(ellipse_at_left,rgba(0,111,207,0.07),transparent_70%)] p-12 md:flex md:flex-col md:justify-between">
        <Link to="/" className="relative flex items-center gap-2">
          <img src="/logo.png" alt="Globalor Limited" className="h-10 w-auto rounded-md bg-white p-1 object-contain" />
        </Link>
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Trading Intelligence</p>
          <h2 className="mt-3 font-display text-4xl font-medium leading-tight text-balance">
            Deploy capital at the speed of computation.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
            Submit invoices, access global liquidity, and monitor enterprise credit risk from a single intelligence dashboard.
          </p>
        </div>
        <div className="relative font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Enterprise Grade · End-to-End Encryption
        </div>
      </div>

      {/* Right form */}
      <div className="relative flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-card">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">{mode === "signup" ? "Access portal" : "Sign in"}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {mode === "signup" ? "Initialize your trading workspace." : "Resume terminal access."}
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            {mode === "signup" && (
              <Field label="Company name">
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required className={inputCls} placeholder="Acme Global" />
              </Field>
            )}
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputCls} placeholder="you@enterprise.com" />
            </Field>
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className={inputCls} placeholder="••••••••" />
            </Field>

            <button disabled={loading} type="submit" className="btn-primary mt-2 inline-flex h-10 w-full items-center justify-center gap-2 px-4 text-sm font-medium disabled:opacity-60">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signup" ? "Initialize Account" : "Access Terminal"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signup" ? "Already deployed?" : "New to the network?"}{" "}
            <button onClick={() => setMode(mode === "signup" ? "signin" : "signup")} className="font-medium text-primary underline-offset-4 transition-colors hover:underline">
              {mode === "signup" ? "Sign in" : "Create account"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
