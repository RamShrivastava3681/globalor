import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { useAppearance, type Appearance } from "@/hooks/use-appearance";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  LayoutDashboard, FileText, BellRing, LogOut, Settings, Shield, Building2, Truck, ShoppingCart, Receipt, Banknote, ClipboardCheck, Boxes, Wallet, FileSignature, BarChart3, ScrollText, Menu, Search, ArrowRightLeft, Sun, Moon, Monitor, BookOpen, FileUp, ChevronsUpDown, Check, Package, ClipboardList, PackageCheck, Quote, TrendingUp, ChevronDown, Cog, Send,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommandPalette, openCommandPalette, type CommandPaletteItem } from "@/components/command-palette";

type NavItem = { to: string; label: string; icon: LucideIcon };
type NavSection = {
  id: string;
  label: string;
  icon: LucideIcon;
  category: string;
  /** When set, the section is a single page and renders as a plain nav link. */
  to?: string;
  items: NavItem[];
};

/** Build a nav section (multi-page groups get a collapsible header). */
function mkSection(id: string, label: string, icon: LucideIcon, to: string | undefined, items: NavItem[], category = "Main"): NavSection {
  return { id, label, icon, to, items, category };
}

// Shared nav items — reused by every role variant below.
const NAV_DASHBOARD: NavItem = { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard };
const NAV_CHECKER: NavItem = { to: "/app/checker", label: "Checker desk", icon: ClipboardCheck };
const NAV_UPLOAD: NavItem = { to: "/app/upload-invoice", label: "Upload invoice", icon: FileUp };
const NAV_QUEUE: NavItem = { to: "/app/queue", label: "Funding queue", icon: Banknote };
const NAV_PROFORMAS: NavItem = { to: "/app/proformas", label: "Proforma invoices", icon: FileSignature };
const NAV_ADVANCES: NavItem = { to: "/app/advances", label: "Advances", icon: Wallet };
const NAV_INVOICES: NavItem = { to: "/app/invoices", label: "Sales invoices", icon: FileText };
const NAV_PURCHASES: NavItem = { to: "/app/purchases", label: "Purchases", icon: ShoppingCart };
const NAV_PURCHASE_ORDERS: NavItem = { to: "/app/purchase-orders", label: "Purchase orders", icon: ClipboardList };
const NAV_SALES_ORDERS: NavItem = { to: "/app/sales-orders", label: "Sales orders", icon: ClipboardCheck };
const NAV_DISPATCHES: NavItem = { to: "/app/dispatches", label: "Dispatches", icon: Truck };
const NAV_GOODS_RECEIPTS: NavItem = { to: "/app/goods-receipts", label: "Goods receipts", icon: PackageCheck };
const NAV_QUOTATIONS: NavItem = { to: "/app/quotations", label: "Quotations", icon: Quote };
const NAV_CREDIT_DEBIT: NavItem = { to: "/app/credit-debit-notes", label: "Credit/Debit notes", icon: ScrollText };
const NAV_DEBTORS: NavItem = { to: "/app/debtors", label: "Debtors", icon: Building2 };
const NAV_SUPPLIERS: NavItem = { to: "/app/vendors", label: "Suppliers", icon: Truck };
const NAV_EXPENSES: NavItem = { to: "/app/expenses", label: "Expenses", icon: Receipt };
const NAV_REPORTS: NavItem = { to: "/app/reports", label: "Reports", icon: BarChart3 };
const NAV_BULK: NavItem = { to: "/app/bulk-payments", label: "Bulk payments", icon: Send };
const NAV_PRODUCTS: NavItem = { to: "/app/products", label: "Products", icon: Package };
const NAV_INVENTORY: NavItem = { to: "/app/inventory", label: "Inventory movements", icon: Boxes };
const NAV_FORECASTING: NavItem = { to: "/app/forecasting", label: "Forecasting", icon: TrendingUp };
const NAV_ALERTS: NavItem = { to: "/app/alerts", label: "Alerts", icon: BellRing };
const NAV_ACCOUNTING: NavItem = { to: "/app/accounting", label: "Accounting", icon: BookOpen };
const NAV_ADMIN: NavItem = { to: "/app/admin", label: "Operations", icon: Shield };
const NAV_SETTINGS: NavItem = { to: "/app/settings", label: "Settings", icon: Settings };

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading, isAdmin, isTreasury, isChecker, isOperations, isViewer, isSuperAdmin, isClient, company_name, company_id, effectiveCompanyId, effectiveCompanyName, impersonatedCompany, setImpersonatedCompany, signOut } = useAuth();
  const { appearance, setAppearance, resolvedTheme } = useAppearance();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);

  // Collapsed state per nav section (persisted to localStorage; the section
  // containing the active route always auto-expands).
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("nav-collapsed");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  // Fetch companies for super admin company switcher
  useEffect(() => {
    if (!isSuperAdmin) return;
    api.get<Array<{ id: string; name: string }>>("/companies")
      .then((data) => setCompanies(data ?? []))
      .catch(() => {});
  }, [isSuperAdmin]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!companyDropdownOpen) return;
    const handler = () => setCompanyDropdownOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [companyDropdownOpen]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  // Role-based route wall
  useEffect(() => {
    if (loading || !user) return;
    const treasuryBlocked = ["/app/invoices", "/app/purchases", "/app/expenses", "/app/checker", "/app/debtors", "/app/inventory", "/app/products", "/app/forecasting", "/app/purchase-orders", "/app/goods-receipts", "/app/sales-orders", "/app/dispatches", "/app/quotations", "/app/suppliers", "/app/admin"];
    const checkerBlocked = ["/app/expenses", "/app/queue", "/app/inventory", "/app/products", "/app/forecasting", "/app/purchase-orders", "/app/goods-receipts", "/app/sales-orders", "/app/dispatches", "/app/quotations", "/app/advances", "/app/debtors", "/app/suppliers", "/app/admin"];
    const operationsBlocked: string[] = [];
    const viewerBlocked = ["/app/admin", "/app/queue", "/app/checker"];
    if (isViewer && viewerBlocked.some((p) => pathname.startsWith(p))) {
      navigate({ to: "/app/dashboard" });
    }
    if (isTreasury && !isAdmin && !isChecker && treasuryBlocked.some((p) => pathname.startsWith(p))) {
      navigate({ to: "/app/queue" });
    }
    if (isChecker && !isAdmin && !isTreasury && checkerBlocked.some((p) => pathname.startsWith(p))) {
      navigate({ to: "/app/checker" });
    }
  }, [loading, user, isTreasury, isChecker, isOperations, isAdmin, pathname, navigate]);

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  const toggleSection = (id: string) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem("nav-collapsed", JSON.stringify(next));
      } catch {
        // ignore persistence errors
      }
      return next;
    });
  };

  // Role-based nav, grouped into collapsible sections under category labels.
  const navSections: NavSection[] = isTreasury && !isAdmin && !isChecker
    ? [
        mkSection("overview", "Dashboard", LayoutDashboard, "/app/dashboard", [NAV_DASHBOARD], "Main"),
        mkSection("funding", "Funding queue", Banknote, "/app/queue", [NAV_QUEUE], "Main"),
        mkSection("transactions", "Transactions", ArrowRightLeft, undefined, [
          NAV_PROFORMAS, NAV_ADVANCES, NAV_CREDIT_DEBIT,
        ], "Operations"),
        mkSection("reports", "Reports", BarChart3, "/app/reports", [NAV_REPORTS], "Main"),
        mkSection("system", "System", Cog, undefined, [NAV_ALERTS, NAV_ACCOUNTING, NAV_SETTINGS], "System"),
      ]
    : isChecker && !isAdmin
    ? [
        mkSection("overview", "Dashboard", LayoutDashboard, "/app/dashboard", [NAV_DASHBOARD], "Main"),
        mkSection("checker", "Checker", ClipboardCheck, "/app/checker", [NAV_CHECKER], "Main"),
        mkSection("transactions", "Transactions", ArrowRightLeft, undefined, [
          NAV_UPLOAD, NAV_INVOICES, NAV_PURCHASES, NAV_PROFORMAS, NAV_CREDIT_DEBIT,
        ], "Operations"),
        mkSection("reports", "Reports", BarChart3, "/app/reports", [NAV_REPORTS], "Main"),
        mkSection("system", "System", Cog, undefined, [NAV_ALERTS, NAV_ACCOUNTING, NAV_SETTINGS], "System"),
      ]
    : isViewer
    ? [
        mkSection("overview", "Dashboard", LayoutDashboard, "/app/dashboard", [NAV_DASHBOARD], "Main"),
        mkSection("transactions", "Transactions", ArrowRightLeft, undefined, [
          NAV_UPLOAD, NAV_INVOICES, NAV_PROFORMAS, NAV_ADVANCES,
          NAV_PURCHASES, NAV_PURCHASE_ORDERS, NAV_SALES_ORDERS, NAV_DISPATCHES,
          NAV_GOODS_RECEIPTS, NAV_QUOTATIONS, NAV_CREDIT_DEBIT, NAV_DEBTORS, NAV_SUPPLIERS, NAV_EXPENSES,
        ], "Operations"),
        mkSection("inventory", "Inventory", Boxes, undefined, [NAV_PRODUCTS, NAV_INVENTORY, NAV_FORECASTING], "Operations"),
        mkSection("reports", "Reports", BarChart3, "/app/reports", [NAV_REPORTS], "Main"),
        mkSection("system", "System", Cog, undefined, [NAV_BULK, NAV_ALERTS, NAV_ACCOUNTING, NAV_SETTINGS], "System"),
      ]
    : [
        mkSection("overview", "Dashboard", LayoutDashboard, "/app/dashboard", [NAV_DASHBOARD], "Main"),
        ...(isAdmin || isChecker
          ? [mkSection("checker", "Checker", ClipboardCheck, "/app/checker", [NAV_CHECKER], "Main")]
          : []
        ),
        mkSection("funding", "Funding queue", Banknote, "/app/queue", [NAV_QUEUE], "Main"),
        mkSection("transactions", "Transactions", ArrowRightLeft, undefined, [
          NAV_UPLOAD, NAV_INVOICES, NAV_PROFORMAS, NAV_ADVANCES,
          NAV_PURCHASES, NAV_PURCHASE_ORDERS, NAV_SALES_ORDERS, NAV_DISPATCHES,
          NAV_GOODS_RECEIPTS, NAV_QUOTATIONS, NAV_CREDIT_DEBIT, NAV_DEBTORS, NAV_SUPPLIERS, NAV_EXPENSES,
        ], "Operations"),
        mkSection("inventory", "Inventory", Boxes, undefined, [NAV_PRODUCTS, NAV_INVENTORY, NAV_FORECASTING], "Operations"),
        mkSection("reports", "Reports", BarChart3, "/app/reports", [NAV_REPORTS], "Main"),
        mkSection("system", "System", Cog, undefined, [
          NAV_BULK, NAV_ALERTS, NAV_ACCOUNTING,
          ...(isSuperAdmin ? [NAV_ADMIN] : []),
          NAV_SETTINGS,
        ], "System"),
      ];

  // Auto-expand the section containing the active route so navigation is never hidden.
  useEffect(() => {
    const activeSection = navSections.find((s) => s.items.some((n) => isActive(n.to)));
    if (activeSection && collapsedSections[activeSection.id]) {
      setCollapsedSections((prev) => ({ ...prev, [activeSection.id]: false }));
    }
  }, [pathname]);

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

  const activeSection = navSections.find((s) => s.items.some((n) => isActive(n.to)));
  const currentNav = activeSection?.items.find((n) => isActive(n.to));
  const pageTitle = currentNav?.label || "Dashboard";
  const PageIcon = currentNav?.icon || LayoutDashboard;
  const currentCategory = activeSection?.category;

  // Flatten nav for the command palette.
  const paletteItems: CommandPaletteItem[] = navSections.flatMap((s) =>
    s.items.map((n) => ({
      id: n.to,
      label: n.label,
      icon: n.icon,
      to: n.to,
      keywords: `${s.label} ${s.category}`,
      group: s.category,
    })),
  );

  const roleLabel = isAdmin ? "Admin" : isTreasury ? "Treasury" : isChecker ? "Checker" : isViewer ? "Viewer" : isOperations ? "Operations" : isClient ? "Client" : "User";

  const appearanceOptions: { value: Appearance; label: string; icon: LucideIcon }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  const sidebarContent = (
    <>
      <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
          <span className="text-sm font-bold text-white">G</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold tracking-tight text-sidebar-accent-foreground truncate">Globalor</span>
            {!isSuperAdmin && company_name && (
              <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[9px] uppercase tracking-wider text-primary font-semibold">{company_name}</span>
            )}
          </div>
          <div className="text-[10px] text-sidebar-foreground/70 tracking-[0.14em] uppercase">Trade Finance OS</div>
        </div>
      </div>

      {/* Quick search */}
      <div className="px-3 pt-3">
        <button
          onClick={openCommandPalette}
          className="flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar px-3 py-2 text-[13px] text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded border border-sidebar-border bg-sidebar-accent/60 px-1.5 py-0.5 font-mono text-[10px] text-sidebar-foreground/60">⌘K</kbd>
        </button>
      </div>

      {/* Super Admin: Company Switcher */}
      {isSuperAdmin && (
        <div className="relative px-3 pt-3">
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
            <div className="absolute left-3 right-3 top-full z-50 mt-1 overflow-hidden rounded-lg border border-sidebar-border bg-popover shadow-lg">
              <div className="max-h-48 overflow-y-auto py-1">
                <button
                  onClick={() => { setImpersonatedCompany(null); setCompanyDropdownOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent ${
                    !impersonatedCompany ? "bg-primary-soft text-primary" : "text-foreground"
                  }`}
                >
                  <div className="flex h-5 w-5 items-center justify-center">
                    {!impersonatedCompany && <Check className="h-3 w-3 text-primary" />}
                  </div>
                  <span className="font-medium">All Companies</span>
                  <span className="ml-auto text-[9px] text-muted-foreground">Super admin</span>
                </button>
                <div className="mx-3 border-t border-border/50" />
                {companies.length === 0 ? (
                  <div className="px-3 py-2 text-[10px] text-muted-foreground">No companies found</div>
                ) : (
                  companies.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setImpersonatedCompany({ id: c.id, name: c.name }); setCompanyDropdownOpen(false); }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent ${
                        impersonatedCompany?.id === c.id ? "bg-primary-soft text-primary" : "text-foreground"
                      }`}
                    >
                      <div className="flex h-5 w-5 items-center justify-center">
                        {impersonatedCompany?.id === c.id && <Check className="h-3 w-3 text-primary" />}
                      </div>
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-soft text-[8px] font-bold text-primary">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {navSections.map((section) => {
          const sectionActive = section.items.some((n) => isActive(n.to));
          const collapsed = !section.to && !!collapsedSections[section.id] && !sectionActive;

          return (
            <div key={section.id}>

              {/* Single-page sections render as a plain nav link. */}
              {section.to ? (
                <Link
                  to={section.to}
                  onClick={() => setMobileSidebarOpen(false)}
                  className={`group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                    sectionActive
                      ? "bg-primary-soft text-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  {sectionActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />}
                  <section.icon className={`h-[18px] w-[18px] shrink-0 ${sectionActive ? "text-primary" : "text-sidebar-foreground/70"}`} />
                  <span>{section.label}</span>
                </Link>
              ) : (
                <>
                  <button
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={!collapsed}
                    className={`group flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors duration-150 ${
                      sectionActive
                        ? "text-primary"
                        : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <section.icon className={`h-4 w-4 shrink-0 ${sectionActive ? "text-primary" : "text-sidebar-foreground/50"}`} />
                    <span className="flex-1">{section.label}</span>
                    <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${collapsed ? "-rotate-90" : "rotate-0"}`} />
                  </button>
                  {!collapsed && (
                    <div className="mt-1 ml-2 space-y-0.5 border-l border-sidebar-border/60 pl-2">
                      {section.items.map((n) => {
                        const active = isActive(n.to);
                        return (
                          <Link
                            key={n.to}
                            to={n.to}
                            onClick={() => setMobileSidebarOpen(false)}
                            className={`group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                              active
                                ? "bg-primary-soft text-primary"
                                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            }`}
                          >
                            {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />}
                            <n.icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-primary" : "text-sidebar-foreground/70"}`} />
                            <span className="truncate">{n.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      <CommandPalette items={paletteItems} />
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <div className="flex h-screen w-full overflow-hidden bg-background">
          <SheetContent side="left" className="w-72 p-0 bg-sidebar border-r border-sidebar-border">
            {sidebarContent}
          </SheetContent>

          {/* Desktop Sidebar */}
          <aside className="hidden w-64 flex-col border-r border-sidebar-border bg-sidebar md:flex">
            {sidebarContent}
          </aside>

          <main className="flex flex-1 min-w-0 flex-col">
            {/* Top Header Bar */}
            <header className="sticky top-0 z-30 flex h-14 flex-none items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <SheetTrigger asChild className="md:hidden">
                  <button
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"
                    aria-label="Open navigation menu"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                </SheetTrigger>
                <div className="hidden min-w-0 items-center gap-2 md:flex">
                  <PageIcon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate text-sm font-medium text-foreground">{pageTitle}</span>
                </div>
                <span className="text-sm font-medium text-foreground md:hidden">{pageTitle}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={openCommandPalette}
                  className="hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>Search</span>
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
                </button>
                <button
                  onClick={openCommandPalette}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent lg:hidden"
                  aria-label="Search"
                >
                  <Search className="h-5 w-5" />
                </button>

                <Link
                  to="/app/alerts"
                  className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"
                  aria-label="Alerts"
                >
                  <BellRing className="h-5 w-5" />
                </Link>

                {/* Appearance */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"
                      aria-label="Change appearance"
                    >
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

                {/* Profile */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-accent"
                      aria-label="Account menu"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
                        {user?.email?.charAt(0).toUpperCase() || "U"}
                      </span>
                      <span className="hidden max-w-[140px] truncate text-sm font-medium text-foreground xl:block">{user?.email}</span>
                      <ChevronsUpDown className="hidden h-3.5 w-3.5 text-muted-foreground xl:block" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel className="truncate">{user?.email}</DropdownMenuLabel>
                    <DropdownMenuLabel className="pb-2 text-xs font-normal text-muted-foreground">
                      {roleLabel}{company_name && !isSuperAdmin ? ` · ${company_name}` : ""}
                      {isSuperAdmin && !impersonatedCompany ? " · All companies" : ""}
                      {isSuperAdmin && impersonatedCompany ? ` · ${impersonatedCompany.name}` : ""}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>

            <div className="flex-1 overflow-auto">
              <Outlet />
            </div>
          </main>
        </div>
      </Sheet>
    </>
  );
}
