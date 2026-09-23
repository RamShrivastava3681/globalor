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
  Truck,
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
      { label: "Logistics", icon: Truck, to: "/app/logistics", roles: ["operations", "treasury", "admin"] },
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
      {
        id: "operations",
        label: "OPERATIONS",
        entries: pick(["Sales", "Procurement", "Product Catalogue", "Warehouse Control", "Logistics"]),
      },
      { id: "finance", label: "FINANCE & INSIGHTS", entries: pick(["Finance", "Reports"]) },
      // System is rendered as an expandable row inside ADMINISTRATION (see below).
      { id: "admin", label: "ADMINISTRATION", entries: [] },
    ];
    // Keep ADMINISTRATION visible when the System group itself is visible,
    // even though it has no direct entries.
    return buckets.filter((b) => b.entries.length > 0 || b.id === "admin");
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
      "group relative flex h-[44px] w-full items-center gap-3 rounded-lg px-3 text-[14px] tracking-[-0.005em] transition-[background-color,color] duration-150 ease-in-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      collapsed && "justify-center px-0",
      active
        ? "bg-[#eaf1fd] font-medium text-[#0b5fc0] dark:bg-sidebar-accent dark:text-sidebar-primary"
        : "font-normal text-[#1e2a3b] hover:bg-[#f2f6fb] hover:text-[#0e1b2c] dark:text-sidebar-foreground dark:hover:bg-sidebar-accent dark:hover:text-sidebar-accent-foreground",
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
    <div className="flex h-full w-full flex-col bg-white font-sans antialiased dark:bg-sidebar">
      {/* Brand header — compact */}
      <div className={cn("flex h-[60px] shrink-0 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[#0b5fc0] dark:bg-sidebar-primary">
          <span className="text-[15px] font-bold text-white dark:text-sidebar-primary-foreground">W</span>
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 leading-none">
              <span className="block truncate text-[15px] font-bold tracking-tight text-[#0f1f33] dark:text-sidebar-accent-foreground">
                Whizunik
              </span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.22em] text-[#8b95a7] dark:text-muted-foreground">
                Command
              </span>
            </span>
            {!hideCollapse && (
              <button
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#9aa6bb] transition-colors duration-150 hover:bg-[#f2f6fb] hover:text-[#1e2a3b] dark:text-muted-foreground dark:hover:bg-sidebar-accent"
              >
                <ChevronsLeft className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </>
        )}
      </div>
      {collapsed && !hideCollapse && (
        <div className="flex shrink-0 justify-center pb-2">
          <button
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#9aa6bb] transition-colors duration-150 hover:bg-[#f2f6fb] hover:text-[#1e2a3b] dark:text-muted-foreground dark:hover:bg-sidebar-accent"
          >
            <ChevronsRight className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Nav region — 16px horizontal padding, 18px section rhythm */}
      <nav aria-label="Primary" className={cn("flex-1 overflow-y-auto pt-1 pb-4", collapsed ? "px-3" : "px-4")}>
        <div className="flex flex-col gap-[18px]">
          {buckets.map((bucket) => {
            if (bucket.id === "admin" && systemVisible.length === 0) return null;
            return (
              <section key={bucket.id} aria-label={bucket.label}>
                {!collapsed && (
                  <p className="mb-[7px] px-3 text-[11px] leading-4 font-semibold tracking-[0.08em] text-[#8b95a7] uppercase dark:text-muted-foreground">
                    {bucket.label}
                  </p>
                )}
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
                          <span
                            aria-hidden
                            className="absolute top-1/2 left-0 h-[18px] w-[3px] -translate-y-1/2 rounded-r-full bg-[#0b5fc0]"
                          />
                        )}
                        <Icon
                          className={cn(
                            "h-[20px] w-[20px] shrink-0",
                            active ? "text-[#0b5fc0] dark:text-sidebar-primary" : "text-[#687892] dark:text-muted-foreground",
                          )}
                          strokeWidth={2}
                        />
                        {!collapsed && <span className="truncate">{e.label}</span>}
                        {renderBadge(e.badge, e.label)}
                      </Link>
                    );
                  })}

                  {/* System — expandable row inside ADMINISTRATION */}
                  {bucket.id === "admin" && systemVisible.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          if (collapsed) {
                            onToggleCollapse();
                            setSystemOpen(true);
                            return;
                          }
                          setSystemOpen((v) => !v);
                        }}
                        aria-expanded={systemOpen}
                        aria-label="System"
                        title={collapsed ? "System" : undefined}
                        className={cn(rowCls(systemActive), "cursor-pointer")}
                      >
                        {systemActive && (
                          <span
                            aria-hidden
                            className="absolute top-1/2 left-0 h-[18px] w-[3px] -translate-y-1/2 rounded-r-full bg-[#0b5fc0]"
                          />
                        )}
                        <Settings
                          className={cn(
                            "h-[20px] w-[20px] shrink-0",
                            systemActive ? "text-[#0b5fc0] dark:text-sidebar-primary" : "text-[#687892] dark:text-muted-foreground",
                          )}
                          strokeWidth={2}
                        />
                        {!collapsed && (
                          <>
                            <span className="flex-1 truncate text-left">System</span>
                            <ChevronRight
                              className={cn(
                                "h-4 w-4 shrink-0 text-[#9aa6bb] transition-transform duration-200 ease-in-out",
                                systemOpen && "rotate-90",
                              )}
                              strokeWidth={2}
                            />
                          </>
                        )}
                      </button>
                      {/* Smooth expand / collapse */}
                      <div
                        className={cn(
                          "grid transition-[grid-template-rows] duration-200 ease-in-out",
                          systemOpen && !collapsed ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                        )}
                      >
                        <div className="overflow-hidden">
                          <div className="mt-[2px] ml-[26px] flex flex-col gap-[2px] border-l border-[#e5ebf2] pl-3 dark:border-sidebar-border">
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
                                  tabIndex={systemOpen && !collapsed ? 0 : -1}
                                  className={cn(
                                    "flex h-[38px] items-center gap-3 rounded-lg px-3 text-[13.5px] transition-[background-color,color] duration-150 ease-in-out",
                                    active
                                      ? "bg-[#eaf1fd] font-medium text-[#0b5fc0] dark:bg-sidebar-accent dark:text-sidebar-primary"
                                      : "font-normal text-[#1e2a3b] hover:bg-[#f2f6fb] dark:text-sidebar-foreground dark:hover:bg-sidebar-accent",
                                  )}
                                >
                                  <CIcon
                                    className={cn(
                                      "h-4 w-4 shrink-0",
                                      active ? "text-[#0b5fc0]" : "text-[#687892]",
                                    )}
                                    strokeWidth={2}
                                  />
                                  <span className="truncate">{c.label}</span>
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
