import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BellRing,
  ClipboardCheck,
  LayoutDashboard,
  ListTodo,
  Mail,
  Package,
  Palette,
  Settings,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Wallet,
  Warehouse,
  ChevronsLeft,
  ChevronsRight,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

export const SIDEBAR_COLLAPSED_KEY = "whizunik-sidebar-collapsed";

type Entry = {
  label: string;
  icon: LucideIcon;
  to: string;
  badge?: number;
  roles: Array<"all" | "checker" | "treasury" | "operations" | "sales_rep" | "admin" | "reporting_manager">;
};

type Bucket = { id: string; label: string; entries: Entry[] };

const fmtBadge = (n: number) => (n > 99 ? "99+" : String(n));

function useSpecRoles() {
  const { isAdmin, isSuperAdmin, isChecker, isTreasury, isOperations, isViewer, isClient } = useAuth();
  const admin = isAdmin || isSuperAdmin;
  return useMemo(() => {
    const has = (r: Entry["roles"][number]): boolean => {
      if (r === "all") return true;
      if (r === "admin") return admin;
      if (r === "checker") return isChecker || admin;
      if (r === "treasury") return isTreasury || admin;
      if (r === "operations") return isOperations || admin;
      if (r === "sales_rep") return isClient || isOperations || admin;
      if (r === "reporting_manager") return admin;
      return false;
    };
    return { has, admin, isViewer, isClient, isOperations, isTreasury, isChecker };
  }, [admin, isChecker, isTreasury, isOperations, isViewer, isClient]);
}

export function useSidebarEntries(checkerCount = 0, queueCount = 0): Bucket[] {
  const { has, isViewer } = useSpecRoles();

  return useMemo(() => {
    const all: Entry[] = [
      { label: "Dashboard", icon: LayoutDashboard, to: "/app/dashboard", roles: ["all"] },
      { label: "My Queue", icon: ListTodo, to: "/app/tasks", badge: queueCount, roles: ["all"] },
      { label: "Checker", icon: ClipboardCheck, to: "/app/checker", badge: checkerCount, roles: ["checker", "admin"] },
      { label: "Finance", icon: Wallet, to: "/app/finance-workbench", roles: ["treasury", "operations", "admin"] },
      { label: "Procurement", icon: ShoppingCart, to: "/app/procurement-workbench", roles: ["operations", "admin"] },
      { label: "Sales", icon: ShoppingBag, to: "/app/sales-workbench", roles: ["sales_rep", "operations", "admin"] },
      { label: "Product Catalogue", icon: Package, to: "/app/products", roles: ["operations", "admin"] },
      { label: "Warehouse Control", icon: Warehouse, to: "/app/warehouse-workbench", roles: ["operations", "admin"] },
      { label: "Reports", icon: BarChart3, to: "/app/reports", roles: ["all"] },
    ];

    // Unknown-role fallback: Dashboard + My Queue only
    const knownStaff = has("checker") || has("treasury") || has("operations") || has("sales_rep") || has("admin");
    const visible = (e: Entry) => {
      if (isViewer) return e.label === "Dashboard" || e.label === "My Queue" || e.label === "Reports";
      if (!knownStaff) return e.label === "Dashboard" || e.label === "My Queue";
      return e.roles.some((r) => has(r));
    };
    const vis = all.filter(visible);
    const byLabel = (l: string) => vis.find((e) => e.label === l);

    const pick = (labels: string[]) => labels.map(byLabel).filter((e): e is Entry => !!e);

    const buckets: Bucket[] = [
      { id: "main", label: "MAIN", entries: pick(["Dashboard", "My Queue", "Checker"]) },
      { id: "sales", label: "SALES & CUSTOMERS", entries: pick(["Sales"]) },
      { id: "proc", label: "PROCUREMENT & SUPPLIERS", entries: pick(["Procurement"]) },
      { id: "prod", label: "PRODUCTS & INVENTORY", entries: pick(["Product Catalogue", "Warehouse Control"]) },
      { id: "fin", label: "FINANCE", entries: pick(["Finance"]) },
      { id: "rep", label: "REPORTS & SYSTEM", entries: pick(["Reports"]) },
    ];
    return buckets.filter((b) => b.entries.length > 0);
  }, [has, isViewer, checkerCount, queueCount]);
}

const SYSTEM_CHILDREN: Entry[] = [
  { label: "Alerts", icon: BellRing, to: "/app/alerts", roles: ["admin"] },
  { label: "Reminders", icon: Mail, to: "/app/reminders", roles: ["admin"] },
  { label: "Operations", icon: Shield, to: "/app/admin", roles: ["admin"] },
  { label: "Invoice template", icon: Palette, to: "/app/template", roles: ["admin"] },
  { label: "Settings", icon: Settings, to: "/app/settings", roles: ["admin", "reporting_manager"] },
];

function useViewAsSearch() {
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const viewAsUserId = typeof search?.viewAsUserId === "string" ? (search.viewAsUserId as string) : undefined;
  return viewAsUserId ? { viewAsUserId } : undefined;
}

export function AppSidebar({
  collapsed,
  onToggleCollapse,
  onNavigate,
  hideCollapse = false,
  checkerCount = 0,
  queueCount = 0,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate?: () => void;
  hideCollapse?: boolean;
  checkerCount?: number;
  queueCount?: number;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const preserveSearch = useViewAsSearch();
  const { has } = useSpecRoles();
  const buckets = useSidebarEntries(checkerCount, queueCount);

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  const systemVisible = SYSTEM_CHILDREN.filter((c) => c.roles.some((r) => has(r as Entry["roles"][number])));
  const systemActive = systemVisible.some((c) => isActive(c.to));
  const [systemOpen, setSystemOpen] = useState(systemActive);

  useEffect(() => {
    if (systemActive) setSystemOpen(true);
    if (collapsed) setSystemOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, collapsed]);

  const rowCls = (active: boolean) =>
    cn(
      "group relative flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-[13.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      collapsed && "justify-center px-0",
      active ? "bg-[#e9f3fe] text-[#0067c2]" : "text-[#334155] hover:bg-[#f1f5f9] hover:text-[#0e1b2c]",
    );

  const renderBadge = (n?: number, label?: string) => {
    if (!n || n <= 0) return null;
    if (collapsed) {
      return <span aria-label={`${n} pending in ${label}`} className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#e5484d]" />;
    }
    return (
      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e5484d] px-1.5 text-[11px] font-bold text-white">
        {fmtBadge(n)}
      </span>
    );
  };

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-sidebar">
      {/* 2.1 Brand header */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0067c2]">
          <span className="text-[17px] font-bold text-white">W</span>
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-bold tracking-tight text-[#0e1b2c] dark:text-sidebar-accent-foreground">
                Whizunik
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.24em] text-[#64748b]">
                Command
              </span>
            </span>
            {!hideCollapse && (
              <button
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#64748b] transition-colors hover:bg-[#f1f5f9]"
              >
                <ChevronsLeft className="h-4 w-4" strokeWidth={1.8} />
              </button>
            )}
          </>
        )}
      </div>
      {collapsed && !hideCollapse && (
        <div className="flex justify-center pb-1">
          <button
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#64748b] transition-colors hover:bg-[#f1f5f9]"
          >
            <ChevronsRight className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      )}

      {/* 2.2 Nav region */}
      <nav aria-label="Primary" className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {buckets.map((bucket) => (
          <div key={bucket.id}>
            <div className="flex flex-col gap-[2px]">
              {bucket.entries.map((e) => {
                const active = isActive(e.to);
                const Icon = e.icon;
                return (
                  <Link
                    key={e.to + e.label}
                    to={e.to}
                    search={preserveSearch as any}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? e.label : undefined}
                    aria-label={e.label}
                    className={rowCls(active)}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#0067c2]" />
                    )}
                    <Icon
                      className={cn("h-5 w-5 shrink-0", active ? "text-[#0067c2]" : "text-[#64748b]")}
                      strokeWidth={1.8}
                    />
                    {!collapsed && <span className="truncate">{e.label}</span>}
                    {!collapsed ? renderBadge(e.badge, e.label) : renderBadge(e.badge, e.label)}
                  </Link>
                );
              })}

              {/* System group lives at the end of REPORTS & SYSTEM */}
              {bucket.id === "rep" && systemVisible.length > 0 && (
                <div>
                  <button
                    onClick={() => setSystemOpen((v) => !v)}
                    aria-expanded={systemOpen}
                    aria-label="System"
                    title={collapsed ? "System" : undefined}
                    className={rowCls(systemActive || systemOpen)}
                  >
                    {(systemActive || systemOpen) && (
                      <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#0067c2]" />
                    )}
                    <Settings
                      className={cn("h-5 w-5 shrink-0", systemActive ? "text-[#0067c2]" : "text-[#64748b]")}
                      strokeWidth={1.8}
                    />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left">System</span>
                        <ChevronRight
                          className={cn("h-4 w-4 transition-transform", systemOpen && "rotate-90")}
                          strokeWidth={1.8}
                        />
                      </>
                    )}
                  </button>
                  {systemOpen && !collapsed && (
                    <div className="mt-1 ml-4 border-l border-[#e5ebf2] pl-3">
                      {systemVisible.map((c) => {
                        const active = isActive(c.to);
                        const CIcon = c.icon;
                        return (
                          <Link
                            key={c.to}
                            to={c.to}
                            search={preserveSearch as any}
                            onClick={onNavigate}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                              active ? "bg-[#e9f3fe] text-[#0067c2]" : "text-[#334155] hover:bg-[#f1f5f9]",
                            )}
                          >
                            <CIcon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                            <span className="truncate">{c.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}
