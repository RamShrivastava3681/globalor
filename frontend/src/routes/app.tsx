import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { useAppearance, type Appearance } from "@/hooks/use-appearance";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { AppSidebar, SIDEBAR_COLLAPSED_KEY } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import {
  BellRing, Menu, Sun, Moon, Monitor, Building2, ChevronsUpDown, Check,
} from "lucide-react";
import { CommandPalette, openCommandPalette, type CommandPaletteItem } from "@/components/command-palette";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading, isAdmin, isSuperAdmin, isTreasury, isChecker, isOperations, isViewer, isClient, company_name, impersonatedCompany, setImpersonatedCompany } = useAuth();
  const { appearance, setAppearance, resolvedTheme } = useAppearance();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleCollapse = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Badge counts (best-effort, UI-only)
  const alertsQ = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => (await api.get<any[]>("/alerts")) ?? [],
    enabled: !!user,
    retry: false,
  });
  const checkerQ = useQuery({
    queryKey: ["invoices", "badge"],
    queryFn: async () => (await api.get<any[]>("/invoices")) ?? [],
    enabled: !!user && (isChecker || isAdmin),
    retry: false,
  });
  const unreadAlerts = (alertsQ.data ?? []).filter((a: any) => !a?.is_read).length;
  const checkerCount = (checkerQ.data ?? []).filter((i: any) => i?.status === "pending" || i?.noa_status === "pending").length;
  // My Queue badge: live count of open tasks assigned to me.
  const queueBadgeQ = useQuery({
    queryKey: ["workflow-queue", "open", "badge"],
    queryFn: async () => (await api.get<any[]>("/workflow-tasks?status=open")) ?? [],
    enabled: !!user,
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: false,
  });
  const queueCount = (queueBadgeQ.data ?? []).filter(
    (t: any) => t?.status === "open" && !!t?.assigned_user &&
      (t.assigned_user === user?.email || t.assigned_user === user?.id),
  ).length;

  // Fetch companies for super admin company switcher
  useEffect(() => {
    if (!isSuperAdmin) return;
    api.get<Array<{ id: string; name: string }>>("/companies")
      .then((data) => setCompanies(data ?? []))
      .catch(() => {});
  }, [isSuperAdmin]);

  useEffect(() => {
    if (!companyDropdownOpen) return;
    const handler = () => setCompanyDropdownOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [companyDropdownOpen]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  // Role-based route wall (§3.1). Admin bypasses.
  useEffect(() => {
    if (loading || !user) return;
    if (isAdmin || isSuperAdmin) return;
    const wb = [
      "/app/sales-workbench", "/app/procurement-workbench", "/app/finance-workbench",
      "/app/warehouse-workbench", "/app/warehouse",
    ];
    const treasuryBlocked = ["/app/invoices", "/app/purchases", "/app/expenses", "/app/checker", "/app/customers", "/app/inventory", "/app/products", "/app/forecasting", "/app/purchase-orders", "/app/goods-receipts", "/app/sales-orders", "/app/dispatches", "/app/quotations", "/app/suppliers", "/app/admin", ...wb.filter((p) => p !== "/app/finance-workbench")];
    const checkerBlocked = ["/app/expenses", "/app/queue", "/app/tasks", "/app/inventory", "/app/products", "/app/forecasting", "/app/purchase-orders", "/app/goods-receipts", "/app/sales-orders", "/app/dispatches", "/app/quotations", "/app/advances", "/app/customers", "/app/suppliers", "/app/admin", "/app/cash", "/app/finance-workbench", "/app/procurement-workbench", "/app/warehouse-workbench"];
    const viewerBlocked = ["/app/admin", "/app/queue", "/app/tasks", "/app/checker", "/app/cash", ...wb];
    const clientBlocked = ["/app/admin", "/app/checker", "/app/queue", "/app/cash", "/app/finance-workbench", "/app/procurement-workbench", "/app/warehouse-workbench"];
    if (isViewer && viewerBlocked.some((p) => pathname.startsWith(p))) {
      navigate({ to: "/app/dashboard" });
    } else if (isTreasury && !isChecker && treasuryBlocked.some((p) => pathname.startsWith(p))) {
      navigate({ to: "/app/queue" });
    } else if (isChecker && !isTreasury && checkerBlocked.some((p) => pathname.startsWith(p))) {
      navigate({ to: "/app/checker" });
    } else if (isClient && !isOperations && clientBlocked.some((p) => pathname.startsWith(p))) {
      navigate({ to: "/app/crm" });
    }
  }, [loading, user, isTreasury, isChecker, isOperations, isAdmin, isSuperAdmin, isViewer, isClient, pathname, navigate]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <div className="text-sm text-muted-foreground">Opening portal…</div>
        </div>
      </div>
    );
  }

  const paletteItems: CommandPaletteItem[] = [
    { id: "/app/dashboard", label: "Dashboard", to: "/app/dashboard", group: "MAIN", icon: Building2 },
    { id: "/app/tasks", label: "My Queue", to: "/app/tasks", group: "MAIN", icon: Building2 },
    { id: "/app/sales-workbench", label: "Sales Workbench", to: "/app/sales-workbench", group: "SALES & CUSTOMERS", icon: Building2 },
    { id: "/app/procurement-workbench", label: "Procurement Workbench", to: "/app/procurement-workbench", group: "PROCUREMENT & SUPPLIERS", icon: Building2 },
    { id: "/app/finance-workbench", label: "Finance Workbench", to: "/app/finance-workbench", group: "FINANCE", icon: Building2 },
    { id: "/app/finance-workbench-cash", label: "Cash Command", to: "/app/finance-workbench", search: { section: "cash" }, keywords: "cash treasury liquidity forecast", group: "FINANCE", icon: Building2 },
    { id: "/app/warehouse-workbench", label: "Warehouse Control", to: "/app/warehouse-workbench", group: "PRODUCTS & INVENTORY", icon: Building2 },
  ];

  const appearanceOptions: { value: Appearance; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  const sidebarWidth = collapsed ? "w-[68px]" : "w-[248px]";

  return (
    <>
      <CommandPalette items={paletteItems} />
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <div className="flex h-screen w-full overflow-hidden bg-[#f5f7fa] dark:bg-background">
          <SheetContent side="left" className="w-[272px] p-0">
            <AppSidebar
              collapsed={false}
              onToggleCollapse={() => {}}
              onNavigate={() => setMobileSidebarOpen(false)}
              hideCollapse
              checkerCount={checkerCount}
              queueCount={queueCount}
            />
          </SheetContent>

          {/* Desktop Sidebar — fixed left, compact 248px / 68px collapsed */}
          <aside
            className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-[#e5ebf2] bg-white transition-[width] duration-200 ease-in-out md:flex dark:bg-sidebar dark:border-sidebar-border ${sidebarWidth}`}
            data-slot="sidebar-aside"
          >
            <AppSidebar
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
              checkerCount={checkerCount}
              queueCount={queueCount}
            />
            {/* Super-admin company switcher (preserved function, below nav) */}
            {isSuperAdmin && !collapsed && (
              <div className="relative border-t border-[#e5ebf2] px-3 py-2 dark:border-sidebar-border">
                <button
                  onClick={(e) => { e.stopPropagation(); setCompanyDropdownOpen(!companyDropdownOpen); }}
                  className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-3 py-2 text-left text-xs transition-colors hover:bg-sidebar-accent/70"
                >
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="flex-1 truncate font-medium text-sidebar-accent-foreground">
                    {impersonatedCompany ? impersonatedCompany.name : "All Companies"}
                  </span>
                  <ChevronsUpDown className="h-3 w-3 shrink-0 text-sidebar-foreground/50" />
                </button>
                {companyDropdownOpen && (
                  <div className="absolute right-3 bottom-full left-3 z-50 mb-1 overflow-hidden rounded-lg border border-sidebar-border bg-popover shadow-lg">
                    <div className="max-h-48 overflow-y-auto py-1">
                      <button
                        onClick={() => { setImpersonatedCompany(null); setCompanyDropdownOpen(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                      >
                        <span className="flex h-5 w-5 items-center justify-center">
                          {!impersonatedCompany && <Check className="h-3 w-3 text-primary" />}
                        </span>
                        <span className="font-medium">All Companies</span>
                      </button>
                      {companies.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => { setImpersonatedCompany({ id: c.id, name: c.name }); setCompanyDropdownOpen(false); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                        >
                          <span className="flex h-5 w-5 items-center justify-center">
                            {impersonatedCompany?.id === c.id && <Check className="h-3 w-3 text-primary" />}
                          </span>
                          <span className="truncate">{c.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            {/* Mobile top navbar */}
            <div className="flex h-14 flex-none items-center justify-between border-b border-border bg-white px-3 md:hidden dark:bg-sidebar">
              <SheetTrigger asChild>
                <button className="rounded-lg p-2 text-muted-foreground hover:bg-accent" aria-label="Open navigation menu">
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0067c2] text-sm font-bold text-white dark:bg-sidebar-primary dark:text-sidebar-primary-foreground">W</span>
              <div className="flex items-center gap-1">
                <Link to="/app/alerts" className="relative rounded-lg p-2 text-muted-foreground hover:bg-accent" aria-label="Alerts">
                  <BellRing className="h-5 w-5" />
                  {unreadAlerts > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#e5484d] px-1 text-[10px] font-bold text-white">
                      {unreadAlerts > 99 ? "99+" : unreadAlerts}
                    </span>
                  )}
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="rounded-lg p-2 text-muted-foreground hover:bg-accent" aria-label="Change appearance">
                      {resolvedTheme === "dark" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Appearance</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={appearance} onValueChange={(v) => setAppearance(v as Appearance)}>
                      {appearanceOptions.map((opt) => (
                        <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                          <opt.icon className="h-4 w-4 text-muted-foreground" />
                          {opt.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* View-as banner */}
            {impersonatedCompany && (
              <div className="flex-none border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-xs font-semibold text-warning md:mx-4 md:mt-3 md:rounded-lg md:border">
                Viewing as {impersonatedCompany.name} — actions apply to this company
              </div>
            )}

            {/* Desktop floating topbar */}
            <AppTopbar alertCount={unreadAlerts} />

            <div className="flex-1 overflow-auto">
              <div key={pathname} className="mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-8 page-enter">
                <Outlet />
              </div>
            </div>
          </main>
        </div>
      </Sheet>
    </>
  );
}
