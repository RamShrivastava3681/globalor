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
  const variant = (() => {
    switch (status) {
      case "pending":
      case "pending_review":
      case "proforma":
        return "pending";
      case "approved":
      case "info":
      case "commented":
        return "approved";
      case "advanced":
      case "paid":
      case "funded":
      case "accepted":
      case "invoiced":
        return "success";
      case "overdue":
      case "rejected":
      case "critical":
      case "disputed":
        return "destructive";
      case "warning":
      case "sent":
        return "warning";
      case "cancelled":
      case "not_sent":
      default:
        return "neutral";
    }
  })();

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]
        bg-[var(--status-${variant}-bg)] text-[var(--status-${variant}-text)] border-[var(--status-${variant}-border)]`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}


