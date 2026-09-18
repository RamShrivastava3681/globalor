import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal, Warehouse } from "lucide-react";
import { StatusPill, fmtMoney } from "@/components/workbench";
import { EmptyState } from "@/components/workbench";
import type { WorkItem } from "@/components/workbench";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const PRI_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function WorkItemsTable({
  items,
  viewAllTo,
  title = "Work items",
  subtitle,
  onAction,
  actionLabel,
}: {
  items: WorkItem[];
  viewAllTo?: string;
  title?: string;
  subtitle?: string;
  /** When provided, row actions stay on the page (switch sub-tab below) instead of redirecting via Link. */
  onAction?: (item: WorkItem) => void;
  actionLabel?: string;
}) {
  const [page, setPage] = useState(1);
  const perPage = 15;

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const od = Number(b.overdue ?? false) - Number(a.overdue ?? false);
      if (od !== 0) return od;
      const p = (PRI_ORDER[a.priority ?? "normal"] ?? 2) - (PRI_ORDER[b.priority ?? "normal"] ?? 2);
      if (p !== 0) return p;
      const dd = String(a.dueDate ?? "9999").localeCompare(String(b.dueDate ?? "9999"));
      if (dd !== 0) return dd;
      return b.id.localeCompare(a.id);
    });
  }, [items]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const cur = Math.min(page, totalPages);
  const slice = sorted.slice((cur - 1) * perPage, cur * perPage);
  const from = sorted.length === 0 ? 0 : (cur - 1) * perPage + 1;
  const to = Math.min(cur * perPage, sorted.length);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3 md:px-5">
        <div>
          <h3 className="font-display text-sm font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {viewAllTo && (
          <Link to={viewAllTo} className="text-xs font-semibold text-primary hover:underline">
            View all
          </Link>
        )}
      </div>
      {sorted.length === 0 ? (
        <EmptyState icon={Warehouse} title="You're all caught up" hint="No work currently requires your attention." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-4 py-2.5">Document</th>
                  <th className="px-4 py-2.5">Counterparty</th>
                  <th className="px-4 py-2.5 text-right">Value</th>
                  <th className="px-4 py-2.5">Current Status</th>
                  <th className="px-4 py-2.5">Next Step</th>
                  <th className="px-4 py-2.5">Owner</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {slice.map((w) => (
                  <tr key={w.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5">
                        {w.openTo && !onAction ? (
                          <Link to={w.openTo} className="font-mono text-[13px] font-semibold text-primary hover:underline">
                            {w.docNumber}
                          </Link>
                        ) : onAction ? (
                          <button onClick={() => onAction(w)} className="font-mono text-[13px] font-semibold text-primary hover:underline">
                            {w.docNumber}
                          </button>
                        ) : (
                          <span className="font-mono text-[13px] font-semibold">{w.docNumber}</span>
                        )}
                        {w.overdue && <span className="h-2 w-2 rounded-full bg-destructive" title="Overdue" />}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">{w.docKind}</span>
                    </td>
                    <td className="px-4 py-2.5">{w.counterparty}</td>
                    <td className="px-4 py-2.5 text-right num">{fmtMoney(w.value)}</td>
                    <td className="px-4 py-2.5"><StatusPill status={w.status} /></td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-muted-foreground" title={w.nextStep}>{w.nextStep}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{w.owner}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center justify-end gap-1">
                        {onAction ? (
                          <button onClick={() => onAction(w)} className={cn("inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover")}>
                            {actionLabel ?? w.actionLabel ?? "Open"}
                          </button>
                        ) : w.openTo ? (
                          <Link to={w.openTo} className={cn("inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover")}>
                            {w.actionLabel ?? "Open"}
                          </Link>
                        ) : (
                          <span className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-white opacity-60">{w.actionLabel ?? "Open"}</span>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="rounded-lg p-1.5 hover:bg-accent" aria-label={`More actions for ${w.docNumber}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {onAction ? (
                              <DropdownMenuItem onSelect={() => onAction(w)}>
                                Open below
                              </DropdownMenuItem>
                            ) : (
                              w.openTo && (
                                <DropdownMenuItem asChild>
                                  <Link to={w.openTo}>Open document</Link>
                                </DropdownMenuItem>
                              )
                            )}
                            <DropdownMenuItem asChild>
                              <Link to="/app/tasks">View in My Queue</Link>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
            <span>Showing {from}–{to} of {sorted.length}</span>
            <span className="flex items-center gap-1.5">
              <button disabled={cur <= 1} onClick={() => setPage(cur - 1)} aria-label="Previous page" className="flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-40">‹</button>
              <span>{cur}/{totalPages}</span>
              <button disabled={cur >= totalPages} onClick={() => setPage(cur + 1)} aria-label="Next page" className="flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-40">›</button>
            </span>
          </div>
        </>
      )}
    </section>
  );
}
