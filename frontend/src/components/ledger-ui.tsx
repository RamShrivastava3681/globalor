import { ReactNode } from "react";
import { AnimatedMoney, AnimatedNumber } from "@/components/animated-number";
import { fmtMoney, fmtDate, fmtDateTime, daysBetween } from "@/lib/format";

export { fmtMoney, fmtDate, fmtDateTime, daysBetween };

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="border-b border-border bg-card px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          {eyebrow && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/8 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.15em] text-primary mb-3">
              {eyebrow}
            </div>
          )}
          <h1 className="font-display text-xl md:text-2xl font-bold tracking-tight text-card-foreground">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, delta, tone = "neutral", animate, numValue, format = "money" }: { label: string; value: string; delta?: string; tone?: "neutral" | "good" | "warn" | "bad"; animate?: boolean; numValue?: number; format?: "money" | "number" }) {
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
    <div className="bg-card border border-border rounded-xl p-4 md:p-5 shadow-card hover:shadow-card-hover transition-shadow duration-200 min-w-0">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {delta && tone !== "neutral" && <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />}
        {label}
      </div>
      <div className="mt-2 num num-lg font-bold tracking-tight text-card-foreground">
        {animate && numValue !== undefined ? (
          format === "money" ? (
            <AnimatedMoney value={numValue} />
          ) : (
            <AnimatedNumber value={numValue} />
          )
        ) : (
          value
        )}
      </div>
      {delta && <div className={`mt-1.5 text-sm font-medium ${toneCls}`}>{delta}</div>}
    </div>
  );
}

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-card border border-border rounded-xl shadow-card overflow-hidden ${className}`} style={{ containerType: "inline-size" }}>
      {title && (
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 md:px-6 md:py-4">
          <h3 className="font-display text-sm md:text-base font-semibold text-card-foreground break-words min-w-0">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-4 md:p-6">{children}</div>
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
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}


