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
    <div className="min-h-screen grid md:grid-cols-2 bg-[#F8FAFC]">
      {/* Left brand */}
      <div className="relative hidden border-r border-[#E2E8F0] bg-gradient-to-br from-[#F0F9FF] to-white p-12 md:flex md:flex-col md:justify-between">
        <Link to="/" className="relative flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#00B8FF] to-[#0099D9] shadow-sm">
            <span className="text-lg font-bold text-white">G</span>
          </div>
          <span className="text-lg font-bold text-[#0F172A]">Globalor</span>
        </Link>
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.2em] text-[#00B8FF] font-medium">Trading Intelligence</p>
          <h2 className="mt-3 font-display text-4xl leading-tight text-balance font-semibold text-[#0F172A]">
            Deploy capital at the speed of computation.
          </h2>
          <p className="mt-4 max-w-md text-sm text-[#64748B] leading-relaxed">
            Submit invoices, access global liquidity, and monitor enterprise credit risk from a single intelligence dashboard.
          </p>
        </div>
        <div className="relative text-xs font-mono tracking-widest text-[#64748B] uppercase">
          Enterprise Grade · End-to-End Encryption
        </div>
      </div>

      {/* Right form */}
      <div className="relative flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-8 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
            <h1 className="font-display text-3xl font-bold text-[#0F172A]">{mode === "signup" ? "Create your account" : "Sign in"}</h1>
            <p className="mt-2 text-sm text-[#64748B]">
              {mode === "signup" ? "Initialize your trading workspace." : "Resume terminal access."}
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-4">
              {mode === "signup" && (
                <Field label="Company name">
                  <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required className="inp-auth" placeholder="Acme Global" />
                </Field>
              )}
              <Field label="Email">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="inp-auth" placeholder="you@enterprise.com" />
              </Field>
              <Field label="Password">
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="inp-auth" placeholder="••••••••" />
              </Field>

              <button disabled={loading} type="submit" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#00B8FF] to-[#0099D9] px-4 py-3 text-sm font-medium text-white shadow-sm hover:shadow-md hover:from-[#0099D9] hover:to-[#0077B6] transition-all disabled:opacity-60">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === "signup" ? "Initialize Account" : "Access Terminal"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-[#64748B]">
              {mode === "signup" ? "Already deployed?" : "New to the network?"}{" "}
              <button onClick={() => setMode(mode === "signup" ? "signin" : "signup")} className="text-[#00B8FF] font-medium underline-offset-4 hover:underline transition-all">
                {mode === "signup" ? "Sign in" : "Create account"}
              </button>
            </p>
          </div>
        </div>
      </div>

      <style>{`
        .inp-auth {
          width: 100%;
          border: 1px solid #E2E8F0;
          color: #0F172A;
          background: #FFFFFF;
          border-radius: 10px;
          padding: 0.75rem 1rem;
          font-size: 0.875rem;
          transition: all 0.2s ease;
        }
        .inp-auth:focus { 
          outline: none; 
          border-color: #00B8FF; 
          box-shadow: 0 0 0 3px rgba(0,184,255,0.12); 
        }
        .inp-auth::placeholder {
          color: #94A3B8;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-medium uppercase tracking-widest text-[#64748B]">{label}</span>
      {children}
    </label>
  );
}
