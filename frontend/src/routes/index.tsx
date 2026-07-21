import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { signUp } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { ArrowUpRight, Bell, ChartLine, Loader2, ShieldCheck, Wallet, Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Globalor — Trading Intelligence & Factoring Platform" },
      { name: "description", content: "Submit invoices, advance capital in hours, and monitor debtor risk in real time." },
      { property: "og:title", content: "Globalor — Trading Intelligence Platform" },
      { property: "og:description", content: "Enterprise-grade factoring and global receivables monitoring." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const { user, refreshSession } = useAuth();
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupCompany, setSignupCompany] = useState("");
  const [signupLoading, setSignupLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signupCompany.trim() || !signupEmail.trim() || !signupPassword) {
      toast.error("Please fill in all fields");
      return;
    }
    setSignupLoading(true);
    try {
      await signUp(signupEmail, signupPassword, signupCompany);
      toast.success("Account created. Welcome to Globalor.");
      await refreshSession();
      navigate({ to: "/app/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setSignupLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60 bg-[linear-gradient(90deg,rgba(0,191,255,0.08),transparent)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="Globalor Limited" className="h-10 w-auto object-contain bg-white p-1 rounded-md" />
          </Link>
          <nav className="hidden gap-8 text-sm text-muted-foreground md:flex">
            <a href="#capabilities" className="hover:text-foreground transition-colors">Capabilities</a>
            <a href="#monitoring" className="hover:text-foreground transition-colors">Monitoring</a>
            <a href="#workflow" className="hover:text-foreground transition-colors">Workflow</a>
          </nav>
          <div className="flex items-center gap-4">
            <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Sign in</Link>
            <Link to="/auth" search={{ mode: "signup" }} className="btn-primary px-5 py-2.5 text-sm font-medium">
              Open portal
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="absolute inset-0 grid-lines opacity-30" aria-hidden />
        <div className="absolute -right-40 top-20 h-[420px] w-[420px] rounded-full bg-primary/20 blur-3xl" aria-hidden />
        <div className="absolute -left-40 top-60 h-[320px] w-[320px] rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-6 py-24 md:py-32">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-glass-card px-4 py-1.5 text-xs text-info backdrop-blur shadow-[0_0_15px_rgba(0,191,255,0.15)]">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Global trading intelligence · v3.0
          </div>
          <h1 className="mt-8 max-w-4xl font-display text-5xl leading-[1.05] tracking-tight text-balance md:text-7xl">
            Turn outstanding invoices into <em className="not-italic text-primary font-medium text-transparent bg-clip-text bg-gradient-to-r from-primary to-primary-hover">working capital</em> — without losing sight of risk.
          </h1>
          <p className="mt-8 max-w-2xl text-lg text-muted-foreground">
            Ledger combines invoice factoring with institutional-grade debtor monitoring.
            Submit, advance, collect — and watch aging, concentration, and credit risk move in real time.
          </p>
          <div className="mt-12 flex flex-wrap items-center gap-4">
            <Link to="/auth" search={{ mode: "signup" }} className="group inline-flex items-center gap-2 btn-primary px-6 py-3.5 text-sm font-medium">
              Access terminal <ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            <Link to="/auth" className="btn-secondary px-6 py-3.5 text-sm font-medium">
              Sign in to console
            </Link>
          </div>

          {/* Stat strip */}
          <div className="mt-24 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border/40 md:grid-cols-4 shadow-xl">
            {[
              { k: "$2.4B", v: "advanced in 2025" },
              { k: "11 hrs", v: "median time to fund" },
              { k: "0.42%", v: "loss rate, trailing 12mo" },
              { k: "98.7%", v: "collection rate" },
            ].map((s) => (
              <div key={s.k} className="bg-glass-card rounded-none p-8 border-none">
                <div className="num text-4xl font-bold tracking-tight text-foreground">{s.k}</div>
                <div className="mt-2 text-xs uppercase tracking-[0.15em] text-muted-foreground">{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="border-b border-border/60 relative overflow-hidden">
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1/3 h-full bg-[radial-gradient(ellipse_at_right,rgba(0,191,255,0.05),transparent_70%)]" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-6 py-24">
          <div className="flex items-end justify-between gap-8">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-primary font-medium">Capabilities</p>
              <h2 className="mt-4 max-w-2xl font-display text-4xl tracking-tight md:text-5xl">An AI-powered command surface for global finance.</h2>
            </div>
          </div>

          <div className="mt-16 grid gap-6 md:grid-cols-3">
            <Feature
              icon={<Wallet className="h-5 w-5" />}
              title="Advance ledger"
              body="Submit invoices, set advance & fee rates, and track reserves and disbursements across every funding event."
            />
            <Feature
              icon={<ChartLine className="h-5 w-5" />}
              title="Aging & DSO"
              body="Live 0/30/60/90+ buckets per debtor and client. DSO trendlines surface stress before it bites."
            />
            <Feature
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Debtor credit"
              body="Score, limit, and concentration in a single view. Trip a limit and you'll know before the wire moves."
            />
            <Feature
              icon={<Bell className="h-5 w-5" />}
              title="Real-time alerts"
              body="Overdue triggers, credit-limit breaches, risk-grade migrations — pushed the moment they happen."
            />
            <Feature
              icon={<Zap className="h-5 w-5" />}
              title="Same-day funding"
              body="Approved invoices clear to client accounts in hours, not days. Reserves released on collection."
            />
            <Feature
              icon={<ArrowUpRight className="h-5 w-5" />}
              title="Portfolio analytics"
              body="Concentration, vintage curves, recovery rates — exportable to your investor committee."
            />
          </div>
        </div>
      </section>

      {/* Monitoring */}
      <section id="monitoring" className="border-b border-border/60 bg-vault relative">
        <div className="mx-auto max-w-7xl px-6 py-24 relative z-10">
          <p className="text-xs uppercase tracking-[0.2em] text-primary font-medium">Monitoring</p>
          <h2 className="mt-4 max-w-3xl font-display text-4xl tracking-tight md:text-5xl">The network doesn't sleep. Neither does your risk.</h2>

          <div className="mt-16 grid gap-8 md:grid-cols-2">
            <Panel title="Aging waterfall" tag="Live">
              <div className="space-y-4">
                {[
                  { label: "Current", pct: 62, val: "$8.42M", tone: "bg-success" },
                  { label: "1–30 days", pct: 22, val: "$2.98M", tone: "bg-primary" },
                  { label: "31–60 days", pct: 10, val: "$1.36M", tone: "bg-warning" },
                  { label: "61–90 days", pct: 4, val: "$540K", tone: "bg-warning" },
                  { label: "90+ days", pct: 2, val: "$272K", tone: "bg-destructive" },
                ].map((b) => (
                  <div key={b.label}>
                    <div className="flex justify-between text-xs font-medium text-muted-foreground">
                      <span>{b.label}</span><span className="num text-foreground tracking-wide">{b.val}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-border/50">
                      <div className={`h-full ${b.tone} shadow-[0_0_10px_currentColor]`} style={{ width: `${b.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Active alerts" tag="3 critical">
              <ul className="space-y-4 text-sm">
                {[
                  { t: "Apex Holdings — credit limit at 94%", s: "warning" },
                  { t: "Invoice #INV-30421 overdue 47 days", s: "destructive" },
                  { t: "Northwind risk grade B → C", s: "warning" },
                  { t: "Vega Logistics payment received — $128K", s: "success" },
                ].map((a, i) => (
                  <li key={i} className="flex items-center gap-4 rounded-xl border border-border/50 bg-black/20 px-4 py-3 backdrop-blur-sm transition-colors hover:bg-black/30">
                    <span className={`h-2.5 w-2.5 rounded-full bg-${a.s} shadow-[0_0_8px_currentColor]`} />
                    <span className="flex-1 font-medium">{a.t}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">just now</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </section>

      {/* Signup Section */}
      <section id="signup" className="border-b border-border/60 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_center,rgba(0,191,255,0.08),transparent_60%)]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/15 blur-[120px] rounded-full pointer-events-none" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 md:py-32 z-10">
          <div className="mx-auto max-w-5xl">
            <div className="text-center">
              <p className="text-xs uppercase tracking-[0.2em] text-primary font-medium">Get started</p>
              <h2 className="mt-4 font-display text-4xl tracking-tight md:text-5xl text-balance">
                Deploy your trading workspace.
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Submit invoices, advance capital, and monitor risk — all from one command surface.
              </p>
            </div>

            <div className="mt-12 mx-auto max-w-lg">
              {user ? (
                <div className="rounded-2xl border border-border/50 bg-glass-card p-8 text-center shadow-xl backdrop-blur">
                  <p className="text-sm text-muted-foreground">You're already signed in.</p>
                  <Link to="/app/dashboard" className="mt-4 inline-flex items-center gap-2 btn-primary px-6 py-3 text-sm font-medium">
                    Go to dashboard
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleSignup} className="rounded-2xl border border-border/50 bg-glass-card p-8 shadow-xl backdrop-blur">
                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Company name</label>
                      <input
                        value={signupCompany}
                        onChange={(e) => setSignupCompany(e.target.value)}
                        required
                        className="landing-input"
                        placeholder="Acme Global Ltd"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Email</label>
                        <input
                          type="email"
                          value={signupEmail}
                          onChange={(e) => setSignupEmail(e.target.value)}
                          required
                          className="landing-input"
                          placeholder="you@company.com"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Password</label>
                        <input
                          type="password"
                          value={signupPassword}
                          onChange={(e) => setSignupPassword(e.target.value)}
                          required
                          minLength={6}
                          className="landing-input"
                          placeholder="••••••••"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={signupLoading}
                    className="mt-6 inline-flex w-full items-center justify-center gap-2 btn-primary px-6 py-3.5 text-sm font-medium disabled:opacity-60 transition-all duration-200 hover:shadow-[0_0_30px_rgba(0,191,255,0.3)]"
                  >
                    {signupLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    {signupLoading ? "Creating workspace…" : "Deploy workspace"}
                  </button>

                  <p className="mt-5 text-center text-xs text-muted-foreground">
                    Already deployed?{" "}
                    <Link to="/auth" className="font-medium text-primary underline-offset-4 hover:underline transition-all">
                      Sign in to your terminal
                    </Link>
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      <style>{`
        .landing-input {
          width: 100%;
          background: rgba(0,0,0,0.25);
          border: 1px solid rgba(56,189,248,0.15);
          color: #fff;
          border-radius: 10px;
          padding: 0.75rem 1rem;
          font-size: 0.875rem;
          transition: all 0.2s ease;
        }
        .landing-input:focus { 
          outline: none; 
          border-color: #00BFFF; 
          background: rgba(0,0,0,0.4);
          box-shadow: 0 0 0 3px rgba(0,191,255,0.15); 
        }
        .landing-input::placeholder {
          color: rgba(148, 163, 184, 0.4);
        }
      `}</style>

      <footer className="mx-auto max-w-7xl px-6 py-12 text-xs text-muted-foreground flex items-center justify-between border-t border-border/40">
        <span>© Globalor Limited. Trading Intelligence Platform.</span>
        <span className="font-mono tracking-widest text-primary/50">v3.0.0</span>
      </footer>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="group bg-glass-card p-8">
      <div className="grid h-12 w-12 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition-all duration-300 group-hover:scale-110 group-hover:bg-primary group-hover:text-white group-hover:shadow-[0_0_20px_rgba(0,191,255,0.4)]">{icon}</div>
      <h3 className="mt-6 font-display text-xl font-medium">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function Panel({ title, tag, children }: { title: string; tag: string; children: React.ReactNode }) {
  return (
    <div className="bg-glass-card p-8">
      <div className="flex items-center justify-between border-b border-border/40 pb-4 mb-6">
        <h3 className="font-display text-lg font-medium">{title}</h3>
        <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[10px] uppercase tracking-widest text-primary">{tag}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}
