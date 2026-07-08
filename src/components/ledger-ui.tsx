import { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="border-b border-border bg-white px-6 py-8 md:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          {eyebrow && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/8 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.15em] text-primary mb-3">
              {eyebrow}
            </div>
          )}
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#0F172A] md:text-3xl">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-[#64748B] leading-relaxed">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, delta, tone = "neutral" }: { label: string; value: string; delta?: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const toneCls = {
    neutral: "text-[#64748B]",
    good: "text-[#16A34A]",
    warn: "text-[#F59E0B]",
    bad: "text-[#DC2626]",
  }[tone];
  const dotCls = {
    neutral: "bg-[#64748B]",
    good: "bg-[#16A34A]",
    warn: "bg-[#F59E0B]",
    bad: "bg-[#DC2626]",
  }[tone];
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] hover:shadow-[0_4px_20px_rgba(15,23,42,0.06)] transition-shadow duration-200 min-w-0">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[#64748B]">
        {delta && tone !== "neutral" && <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />}
        {label}
      </div>
      <div className="mt-2 num num-lg font-bold tracking-tight text-[#0F172A]">{value}</div>
      {delta && <div className={`mt-1.5 text-sm font-medium ${toneCls}`}>{delta}</div>}
    </div>
  );
}

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-[#E2E8F0] rounded-xl shadow-[0_1px_3px_rgba(15,23,42,0.06)] overflow-hidden ${className}`} style={{ containerType: "inline-size" }}>
      {title && (
        <div className="flex items-center justify-between border-b border-[#E2E8F0]/60 px-6 py-4">
          <h3 className="font-display text-base font-semibold text-[#0F172A]">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]",
    approved: "bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]",
    advanced: "bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]",
    paid: "bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]",
    overdue: "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]",
    rejected: "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]",
    critical: "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]",
    warning: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]",
    info: "bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]",
    funded: "bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]",
    cancelled: "bg-[#F8F9FA] text-[#6B7280] border-[#E5E7EB]",
    disputed: "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]",
    not_sent: "bg-[#F8F9FA] text-[#6B7280] border-[#E5E7EB]",
    sent: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]",
    accepted: "bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]",
    commented: "bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]",
    pending_review: "bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]",
    proforma: "bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]",
    invoiced: "bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]",
  };
  const cls = map[status] ?? "bg-[#F8F9FA] text-[#6B7280] border-[#E5E7EB]";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${cls}`}>
      {status === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-[#C2410C]" />}
      {status === "approved" && <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB]" />}
      {(status === "paid" || status === "advanced" || status === "funded" || status === "invoiced") && <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />}
      {(status === "overdue" || status === "rejected" || status === "critical" || status === "disputed") && <span className="h-1.5 w-1.5 rounded-full bg-[#DC2626]" />}
      {(status === "warning" || status === "sent" || status === "pending_review") && <span className="h-1.5 w-1.5 rounded-full bg-[#D97706]" />}
      {status === "accepted" && <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />}
      {(status === "info" || status === "commented" || status === "approved") && <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB]" />}
      {status === "not_sent" && <span className="h-1.5 w-1.5 rounded-full bg-[#6B7280]" />}
      {status && !["pending","approved","paid","advanced","overdue","rejected","critical","warning","info","funded","cancelled","disputed","not_sent","sent","accepted","commented","pending_review","proforma","invoiced"].includes(status) && <span className="h-1.5 w-1.5 rounded-full bg-[#6B7280]" />}
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function fmtMoney(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v);
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function daysBetween(a: string, b: string = new Date().toISOString()) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}
