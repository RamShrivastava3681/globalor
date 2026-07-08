import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Bell, ChartLine, ShieldCheck, Wallet, Zap } from "lucide-react";

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
  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <header className="border-b border-[#E2E8F0] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#00B8FF] to-[#0099D9] shadow-sm">
              <span className="text-lg font-bold text-white">G</span>
            </div>
            <span className="text-lg font-bold text-[#0F172A]">Globalor</span>
          </Link>
          <nav className="hidden gap-8 text-sm text-[#64748B] md:flex">
            <a href="#capabilities" className="hover:text-[#0F172A] transition-colors">Capabilities</a>
            <a href="#monitoring" className="hover:text-[#0F172A] transition-colors">Monitoring</a>
            <a href="#workflow" className="hover:text-[#0F172A] transition-colors">Workflow</a>
          </nav>
          <div className="flex items-center gap-4">
            <Link to="/auth" className="text-sm text-[#64748B] hover:text-[#0F172A] transition-colors">Sign in</Link>
            <Link to="/auth" search={{ mode: "signup" }} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#00B8FF] to-[#0099D9] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:shadow-md hover:from-[#0099D9] hover:to-[#0077B6] transition-all">
              Open portal
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[#E2E8F0] bg-white">
        <div className="absolute -right-40 top-20 h-[420px] w-[420px] rounded-full bg-[#00B8FF]/5 blur-3xl" aria-hidden />
        <div className="absolute -left-40 top-60 h-[320px] w-[320px] rounded-full bg-[#00B8FF]/5 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-6 py-24 md:py-32">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#E2E8F0] bg-white px-4 py-1.5 text-xs text-[#00B8FF] shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00B8FF] animate-pulse" />
            Global trading intelligence · v3.0
          </div>
          <h1 className="mt-8 max-w-4xl font-display text-5xl leading-[1.05] tracking-tight text-balance md:text-7xl text-[#0F172A]">
            Turn outstanding invoices into <em className="not-italic text-transparent bg-clip-text bg-gradient-to-r from-[#00B8FF] to-[#0099D9] font-semibold">working capital</em> — without losing sight of risk.
          </h1>
          <p className="mt-8 max-w-2xl text-lg text-[#64748B]">
            Globalor combines invoice factoring with institutional-grade debtor monitoring.
            Submit, advance, collect — and watch aging, concentration, and credit risk move in real time.
          </p>
          <div className="mt-12 flex flex-wrap items-center gap-4">
            <Link to="/auth" search={{ mode: "signup" }} className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#00B8FF] to-[#0099D9] px-6 py-3.5 text-sm font-medium text-white shadow-sm hover:shadow-md hover:from-[#0099D9] hover:to-[#0077B6] transition-all">
              Access terminal <ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            <Link to="/auth" className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-6 py-3.5 text-sm font-medium text-[#0F172A] shadow-sm hover:bg-[#F8FAFC] hover:border-[#CBD5E1] transition-all">
              Sign in to console
            </Link>
          </div>

          {/* Stat strip */}
          <div className="mt-24 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#E2E8F0] shadow-xl md:grid-cols-4">
            {[
              { k: "$2.4B", v: "advanced in 2025" },
              { k: "11 hrs", v: "median time to fund" },
              { k: "0.42%", v: "loss rate, trailing 12mo" },
              { k: "98.7%", v: "collection rate" },
            ].map((s) => (
              <div key={s.k} className="bg-white p-8">
                <div className="num text-4xl font-bold tracking-tight text-[#0F172A]">{s.k}</div>
                <div className="mt-2 text-xs uppercase tracking-[0.15em] text-[#64748B]">{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="border-b border-[#E2E8F0] relative overflow-hidden bg-white">
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1/3 h-full bg-[radial-gradient(ellipse_at_right,rgba(0,184,255,0.04),transparent_70%)]" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-6 py-24">
          <div className="flex items-end justify-between gap-8">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#00B8FF] font-medium">Capabilities</p>
              <h2 className="mt-4 max-w-2xl font-display text-4xl tracking-tight md:text-5xl text-[#0F172A]">An AI-powered command surface for global finance.</h2>
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
      <section id="monitoring" className="border-b border-[#E2E8F0] bg-gradient-to-br from-[#F8FAFC] to-white relative">
        <div className="mx-auto max-w-7xl px-6 py-24 relative z-10">
          <p className="text-xs uppercase tracking-[0.2em] text-[#00B8FF] font-medium">Monitoring</p>
          <h2 className="mt-4 max-w-3xl font-display text-4xl tracking-tight md:text-5xl text-[#0F172A]">The network doesn't sleep. Neither does your risk.</h2>

          <div className="mt-16 grid gap-8 md:grid-cols-2">
            <Panel title="Aging waterfall" tag="Live">
              <div className="space-y-4">
                {[
                  { label: "Current", pct: 62, val: "$8.42M", tone: "bg-[#16A34A]" },
                  { label: "1–30 days", pct: 22, val: "$2.98M", tone: "bg-[#00B8FF]" },
                  { label: "31–60 days", pct: 10, val: "$1.36M", tone: "bg-[#F59E0B]" },
                  { label: "61–90 days", pct: 4, val: "$540K", tone: "bg-[#F97316]" },
                  { label: "90+ days", pct: 2, val: "$272K", tone: "bg-[#DC2626]" },
                ].map((b) => (
                  <div key={b.label}>
                    <div className="flex justify-between text-xs font-medium text-[#64748B]">
                      <span>{b.label}</span><span className="num text-[#0F172A] tracking-wide">{b.val}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E2E8F0]">
                      <div className={`h-full ${b.tone} rounded-full`} style={{ width: `${b.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Active alerts" tag="3 critical">
              <ul className="space-y-4 text-sm">
                {[
                  { t: "Apex Holdings — credit limit at 94%", s: "text-[#F59E0B]" },
                  { t: "Invoice #INV-30421 overdue 47 days", s: "text-[#DC2626]" },
                  { t: "Northwind risk grade B → C", s: "text-[#F59E0B]" },
                  { t: "Vega Logistics payment received — $128K", s: "text-[#16A34A]" },
                ].map((a, i) => (
                  <li key={i} className="flex items-center gap-4 rounded-xl border border-[#E2E8F0] bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
                    <span className={`h-2.5 w-2.5 rounded-full ${a.s === "text-[#16A34A]" ? "bg-[#16A34A]" : a.s === "text-[#DC2626]" ? "bg-[#DC2626]" : "bg-[#F59E0B]"}`} />
                    <span className="flex-1 font-medium text-[#0F172A]">{a.t}</span>
                    <span className="text-[10px] uppercase tracking-wider text-[#64748B]">just now</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="workflow" className="border-b border-[#E2E8F0] relative overflow-hidden bg-white">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[#00B8FF]/5 blur-[100px] rounded-full pointer-events-none" />
        <div className="relative mx-auto max-w-7xl px-6 py-32 text-center z-10">
          <h2 className="mx-auto max-w-3xl font-display text-4xl tracking-tight md:text-6xl text-balance font-semibold text-[#0F172A]">
            Deploy global capital. Fund tomorrow's growth today.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg text-[#64748B]">
            Spin up an enterprise trading intelligence portal in seconds.
          </p>
          <div className="mt-10 flex justify-center gap-4">
            <Link to="/auth" search={{ mode: "signup" }} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#00B8FF] to-[#0099D9] px-8 py-4 text-sm font-medium text-white shadow-sm hover:shadow-md hover:from-[#0099D9] hover:to-[#0077B6] transition-all">Deploy portal</Link>
            <Link to="/auth" className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-8 py-4 text-sm font-medium text-[#0F172A] shadow-sm hover:bg-[#F8FAFC] hover:border-[#CBD5E1] transition-all">Sign in</Link>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-7xl px-6 py-12 text-xs text-[#64748B] flex items-center justify-between border-t border-[#E2E8F0]">
        <span>© Globalor Limited. Trading Intelligence Platform.</span>
        <span className="font-mono tracking-widest text-[#00B8FF]/50">v3.0.0</span>
      </footer>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="group rounded-xl border border-[#E2E8F0] bg-white p-8 shadow-[0_1px_3px_rgba(15,23,42,0.06)] hover:shadow-[0_4px_20px_rgba(15,23,42,0.06)] transition-all duration-200">
      <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#F0F9FF] text-[#00B8FF] transition-all duration-300 group-hover:scale-110 group-hover:bg-gradient-to-br group-hover:from-[#00B8FF] group-hover:to-[#0099D9] group-hover:text-white group-hover:shadow-md">{icon}</div>
      <h3 className="mt-6 font-display text-xl font-semibold text-[#0F172A]">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-[#64748B]">{body}</p>
    </div>
  );
}

function Panel({ title, tag, children }: { title: string; tag: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-8 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-4 mb-6">
        <h3 className="font-display text-lg font-semibold text-[#0F172A]">{title}</h3>
        <span className="rounded-full border border-[#00B8FF]/30 bg-[#F0F9FF] px-3 py-1 text-[10px] uppercase tracking-widest text-[#00B8FF] font-semibold">{tag}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}
