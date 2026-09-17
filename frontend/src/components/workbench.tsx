import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill, fmtMoney } from "@/components/ledger-ui";

export { StatusPill, fmtMoney };

/* ── WorkbenchHeader: bordered header band with 40px icon tile ── */
export function WorkbenchHeader({
  icon: Icon,
  title,
  subtitle,
  context,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  context?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5 shadow-card md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-primary/20 bg-primary/10">
          <Icon className="h-5 w-5 text-primary" strokeWidth={1.8} />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-[20px] font-semibold tracking-tight text-[#0f1f38]">
            {title}
          </span>
          {subtitle && <span className="block truncate text-[13px] text-muted-foreground">{subtitle}</span>}
        </span>
      </div>
      {(context || actions) && (
        <div className="flex shrink-0 items-center gap-2">
          {context}
          {actions}
        </div>
      )}
    </div>
  );
}

/* ── WorkbenchTabs / NavTab: underline tab row, same-page state only ── */
export type NavTabDef = { id: string; label: string; icon?: LucideIcon };

export function WorkbenchTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: NavTabDef[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" aria-label="Workbench sections" className="whiz-tabs -mb-px flex min-w-max gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const isActive = t.id === active;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? "page" : undefined}
            data-active={isActive}
            onClick={() => onChange(t.id)}
            className={cn(
              "whiz-tab flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-4 w-4" strokeWidth={1.8} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* Back-compat alias used across workbenches */
export const NavTabs = WorkbenchTabs;

/* ── KpiTint: tinted KPI ── */
const TINT_CLS: Record<string, string> = {
  blue: "border-primary/25 bg-[#eef7ff]",
  amber: "border-warning/30 bg-warning/10",
  red: "border-destructive/30 bg-destructive/10",
  green: "border-success/30 bg-success/10",
};

export function KpiTint({
  label,
  value,
  hint,
  tint = "blue",
  icon: Icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tint?: "blue" | "amber" | "red" | "green";
  icon?: LucideIcon;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />}
      </div>
      <div className="num mt-1.5 font-display text-[28px] font-semibold tracking-tight text-foreground">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </>
  );
  const cls = cn("rounded-xl border p-4 text-left shadow-card", TINT_CLS[tint]);
  if (onClick) {
    return (
      <button onClick={onClick} className={cn(cls, "transition-shadow hover:shadow-card-hover")}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

/* ── KpiCard: white card, clickable, amber-tinted border for attention ── */
export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
  onClick,
  loading,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon: LucideIcon;
  tone?: "neutral" | "attention" | "blue";
  onClick?: () => void;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative rounded-xl border bg-card p-5 text-left shadow-card transition-shadow hover:shadow-card-hover",
        tone === "attention" ? "border-warning/40" : "border-border",
      )}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-[18px] w-[18px] text-primary" strokeWidth={1.8} />
      </span>
      <span className="mt-3 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className="num mt-1 block font-display text-[30px] font-semibold leading-none tracking-tight text-foreground">
        {loading ? "—" : value}
      </span>
      {sub && <span className="mt-1.5 block text-xs text-muted-foreground">{sub}</span>}
    </button>
  );
}

/* ── SectionCard: standard section shell ── */
export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-card", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3 md:px-5">
          <div className="min-w-0">
            {typeof title === "string" ? (
              <h3 className="font-display text-sm font-semibold text-card-foreground">{title}</h3>
            ) : (
              title
            )}
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

/* ── FooterBanner: footer strip ── */
export function FooterBanner({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-lg border border-border/70 bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

/* ── DocAction: small doc button ── */
export function DocAction({
  children,
  onClick,
  to,
  variant = "primary",
}: {
  children: ReactNode;
  onClick?: () => void;
  to?: string;
  variant?: "primary" | "outline" | "ghost";
}) {
  const cls = cn(
    "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors",
    variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary-hover",
    variant === "outline" && "border border-border bg-card hover:bg-accent",
    variant === "ghost" && "hover:bg-accent",
  );
  if (to) {
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

/* ── Filter pills (All | GRNs | Dispatches …) ── */
export function FilterPills<T extends string>({
  options,
  active,
  onChange,
}: {
  options: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={o.id === active}
          className={cn(
            "h-8 rounded-full border px-3 text-xs font-semibold transition-colors",
            o.id === active
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-border hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Skeletons ── */
export function StatSkeleton() {
  return <div className="h-[118px] animate-pulse rounded-xl border border-border bg-muted/60" />;
}

export function TableSkeleton({ rows = 6, cols = 8 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Loading table">
      <div className="space-y-2 p-4">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-2">
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="h-8 flex-1 animate-pulse rounded-md bg-muted/70" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.8} />
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}

/* ── Shared work-item table types ── */
export type WorkItem = {
  id: string;
  docNumber: string;
  docKind: string;
  counterparty: string;
  value: number;
  status: string;
  nextStep: string;
  owner: string;
  dueDate?: string | null;
  overdue?: boolean;
  priority?: "urgent" | "high" | "normal" | "low";
  actionLabel?: string;
  openTo?: string;
  queueAnchor?: string;
};
