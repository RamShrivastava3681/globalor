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
    <div className="min-h-screen grid md:grid-cols-2 bg-main relative">
      <div className="absolute inset-0 grid-lines opacity-20 pointer-events-none" aria-hidden />
      
      {/* Left brand */}
      <div className="relative hidden border-r border-border bg-[radial-gradient(ellipse_at_left,rgba(0,191,255,0.08),transparent_70%)] p-12 md:flex md:flex-col md:justify-between z-10">
        <Link to="/" className="relative flex items-center gap-2">
          <img src="/logo.png" alt="Globalor Limited" className="h-10 w-auto object-contain bg-white p-1 rounded-md" />
        </Link>
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Trading Intelligence</p>
          <h2 className="mt-3 font-display text-4xl leading-tight text-balance font-medium">
            Deploy capital at the speed of computation.
          </h2>
          <p className="mt-4 max-w-md text-sm text-muted-foreground leading-relaxed">
            Submit invoices, access global liquidity, and monitor enterprise credit risk from a single intelligence dashboard.
          </p>
        </div>
        <div className="relative text-xs font-mono tracking-widest text-muted-foreground uppercase">
          Enterprise Grade · End-to-End Encryption
        </div>
      </div>

      {/* Right form */}
      <div className="relative flex items-center justify-center p-6 md:p-12 z-10">
        <div className="w-full max-w-md bg-glass-card p-8 shadow-2xl">
          <h1 className="font-display text-3xl font-medium">{mode === "signup" ? "Access portal" : "Sign in"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signup" ? "Initialize your trading workspace." : "Resume terminal access."}
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            {mode === "signup" && (
              <Field label="Company name">
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required className="input" placeholder="Acme Global" />
              </Field>
            )}
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="input" placeholder="you@enterprise.com" />
            </Field>
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="input" placeholder="••••••••" />
            </Field>

            <button disabled={loading} type="submit" className="mt-4 inline-flex w-full items-center justify-center gap-2 btn-primary px-4 py-3 text-sm font-medium disabled:opacity-60">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signup" ? "Initialize Account" : "Access Terminal"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signup" ? "Already deployed?" : "New to the network?"}{" "}
            <button onClick={() => setMode(mode === "signup" ? "signin" : "signup")} className="text-primary font-medium underline-offset-4 hover:underline transition-all">
              {mode === "signup" ? "Sign in" : "Create account"}
            </button>
          </p>
        </div>
      </div>

      <style>{`
        .input {
          width: 100%;
          background: rgba(0,0,0,0.2);
          border: 1px solid rgba(56,189,248,0.2);
          color: #fff;
          border-radius: 10px;
          padding: 0.75rem 1rem;
          font-size: 0.875rem;
          transition: all 0.2s ease;
        }
        .input:focus { 
          outline: none; 
          border-color: #00BFFF; 
          background: rgba(0,0,0,0.4);
          box-shadow: 0 0 0 3px rgba(0,191,255,0.15); 
        }
        .input::placeholder {
          color: rgba(148, 163, 184, 0.5);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
