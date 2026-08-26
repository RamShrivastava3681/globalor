import { ReactNode } from "react";
import { AnimatedMoney, AnimatedNumber } from "@/components/animated-number";
import { fmtMoney, fmtDate, fmtDateTime, daysBetween } from "@/lib/format";

export { fmtMoney, fmtDate, fmtDateTime, daysBetween };

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: string; actions?: ReactNode }) {
  return (
    <div className="border-b border-border bg-background px-4 py-5 md:px-6 md:py-6">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          {eyebrow && (
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
              {eyebrow}
            </div>
          )}
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground md:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, delta, tone = "neutral", animate, numValue, format = "money" }: { label: string; value: string; delta?: string; tone?: "neutral" | "good" | "warn" | "bad"; animate?: boolean; numValue?: number; format?: "money" | "number" }) {
  const toneCls = {
    neutral: "text-muted-foreground",
    good: "text-success",
    warn: "text-warning",
    bad: "text-destructive",
  }[tone];
  const dotCls = {
    neutral: "bg-muted-foreground",
    good: "bg-success",
    warn: "bg-warning",
    bad: "bg-destructive",
  }[tone];
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {delta && tone !== "neutral" && <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />}
        {label}
      </div>
      <div className="mt-2 num num-lg font-semibold tracking-tight text-card-foreground">
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
      {delta && <div className={`mt-1.5 text-[13px] ${toneCls}`}>{delta}</div>}
    </div>
  );
}

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-lg border border-border bg-card ${className}`} style={{ containerType: "inline-size" }}>
      {title && (
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3 md:px-5 md:py-3.5">
          <h3 className="min-w-0 break-words font-display text-sm font-semibold text-card-foreground">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-4 md:p-5">{children}</div>
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
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]
        bg-[var(--status-${variant}-bg)] text-[var(--status-${variant}-text)] border-[var(--status-${variant}-border)]`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
