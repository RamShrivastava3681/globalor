import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  LayoutDashboard, FileText, BellRing, LogOut, Settings, Shield, Building2, Truck, ShoppingCart, Receipt, Banknote, ClipboardCheck, Boxes, Wallet, FileSignature, User, BarChart3, ScrollText, Menu, Search, ArrowRightLeft, Sun, Moon, BookOpen
} from "lucide-react";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading, isAdmin, isTreasury, isChecker, isOperations, isViewer, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [themeToggleKey, setThemeToggleKey] = useState(0);
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("theme");
      if (stored) return stored === "dark";
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [isDark]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  // Role-based route wall
  useEffect(() => {
    if (loading || !user) return;
    const treasuryBlocked = ["/app/invoices", "/app/purchases", "/app/expenses", "/app/checker", "/app/debtors", "/app/inventory", "/app/suppliers", "/app/admin"];
    const checkerBlocked = ["/app/expenses", "/app/queue", "/app/inventory", "/app/advances", "/app/debtors", "/app/suppliers", "/app/admin"];
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

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#00B8FF] border-t-transparent" />
          <div className="text-sm text-muted-foreground">Opening portal…</div>
        </div>
      </div>
    );
  }

  const nav = isTreasury && !isAdmin && !isChecker
    ? [
        { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { to: "/app/queue", label: "Funding queue", icon: Banknote },
        { to: "/app/proformas", label: "Proforma invoices", icon: FileSignature },
        { to: "/app/advances", label: "Advances", icon: Wallet },
        { to: "/app/alerts", label: "Alerts", icon: BellRing },
        { to: "/app/reports", label: "Reports", icon: BarChart3 },
        { to: "/app/credit-debit-notes", label: "Credit/Debit notes", icon: ScrollText },
        { to: "/app/accounting", label: "Accounting", icon: BookOpen },
        { to: "/app/settings", label: "Settings", icon: Settings },
      ]
    : isChecker && !isAdmin
    ? [
        { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { to: "/app/checker", label: "Checker desk", icon: ClipboardCheck },
        { to: "/app/invoices", label: "Sales invoices", icon: FileText },
        { to: "/app/purchases", label: "Purchases", icon: ShoppingCart },
        { to: "/app/reports", label: "Reports", icon: BarChart3 },
        { to: "/app/proformas", label: "Proforma invoices", icon: FileSignature },
        { to: "/app/credit-debit-notes", label: "Credit/Debit notes", icon: ScrollText },
        { to: "/app/alerts", label: "Alerts", icon: BellRing },
        { to: "/app/accounting", label: "Accounting", icon: BookOpen },
        { to: "/app/settings", label: "Settings", icon: Settings },
      ]
    : isViewer
    ? [
        { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { to: "/app/proformas", label: "Proforma invoices", icon: FileSignature },
        { to: "/app/invoices", label: "Sales invoices", icon: FileText },
        { to: "/app/purchases", label: "Purchases", icon: ShoppingCart },
        { to: "/app/reports", label: "Reports", icon: BarChart3 },
        { to: "/app/expenses", label: "Expenses", icon: Receipt },
        { to: "/app/advances", label: "Advances", icon: Wallet },
        { to: "/app/bulk-payments", label: "Bulk payments", icon: ArrowRightLeft },
        { to: "/app/inventory", label: "Inventory", icon: Boxes },
        { to: "/app/debtors", label: "Debtors", icon: Building2 },
        { to: "/app/vendors", label: "Suppliers", icon: Truck },
        { to: "/app/credit-debit-notes", label: "Credit/Debit notes", icon: ScrollText },
        { to: "/app/alerts", label: "Alerts", icon: BellRing },
        { to: "/app/accounting", label: "Accounting", icon: BookOpen },
        { to: "/app/settings", label: "Settings", icon: Settings },
      ]
    : [
        { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
        ...(isAdmin || isChecker ? [{ to: "/app/checker", label: "Checker desk", icon: ClipboardCheck }] : []),
        { to: "/app/queue", label: "Funding queue", icon: Banknote },
        { to: "/app/proformas", label: "Proforma invoices", icon: FileSignature },
        { to: "/app/invoices", label: "Sales invoices", icon: FileText },
        { to: "/app/purchases", label: "Purchases", icon: ShoppingCart },
        { to: "/app/reports", label: "Reports", icon: BarChart3 },
        { to: "/app/expenses", label: "Expenses", icon: Receipt },
        { to: "/app/advances", label: "Advances", icon: Wallet },
        { to: "/app/bulk-payments", label: "Bulk payments", icon: ArrowRightLeft },
        { to: "/app/inventory", label: "Inventory", icon: Boxes },
        { to: "/app/debtors", label: "Debtors", icon: Building2 },
        { to: "/app/vendors", label: "Suppliers", icon: Truck },
        { to: "/app/credit-debit-notes", label: "Credit/Debit notes", icon: ScrollText },
        { to: "/app/alerts", label: "Alerts", icon: BellRing },
        { to: "/app/accounting", label: "Accounting", icon: BookOpen },
        ...(isAdmin ? [{ to: "/app/admin", label: "Operations", icon: Shield }] : []),
        { to: "/app/settings", label: "Settings", icon: Settings },
      ];

  const currentNav = nav.find((n) => pathname === n.to || pathname.startsWith(n.to + "/"));
  const pageTitle = currentNav?.label || "Dashboard";
  const PageIcon = currentNav?.icon || LayoutDashboard;

  const sidebarContent = (
    <>
      <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#00B8FF] to-[#0099D9] shadow-sm">
          <span className="text-sm font-bold text-white">G</span>
        </div>
        <div>
          <div className="text-sm font-bold text-sidebar-accent-foreground">Globalor</div>
          <div className="text-[10px] text-sidebar-foreground tracking-wide">Trade Finance OS</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-4 overflow-y-auto">
        {nav.map((n) => {
          const active = pathname === n.to || pathname.startsWith(n.to + "/");
          const Icon = n.icon;
          return (
            <Link
              key={n.to}
              to={n.to}
              onClick={() => setMobileSidebarOpen(false)}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 transition-colors ${
                active ? "text-sidebar-primary" : "text-sidebar-foreground group-hover:text-sidebar-accent-foreground"
              }`} />
              <span>{n.label}</span>
              {active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#00B8FF]" />
              )}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-4">
        <div className="rounded-xl bg-sidebar-accent/50 border border-sidebar-border p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-foreground/20 text-sm font-medium text-sidebar-foreground">
              {user?.email?.charAt(0).toUpperCase() || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-sidebar-accent-foreground truncate">{user?.email}</div>
              <div className="text-[10px] text-sidebar-foreground">
                {isAdmin ? "Admin" : isTreasury ? "Treasury" : isChecker ? "Checker" : isViewer ? "Viewer" : isOperations ? "Operations" : "User"}
              </div>
            </div>
          </div>
          <button onClick={signOut} className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-sidebar-border bg-sidebar px-3 py-1.5 text-xs text-sidebar-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors">
            <LogOut className="h-3 w-3" />
            Sign out
          </button>
        </div>
      </div>
    </>
  );

  return (
    <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <SheetContent side="left" className="w-72 p-0 bg-sidebar border-r border-sidebar-border">
        {sidebarContent}
      </SheetContent>

      {/* Desktop Sidebar */}
      <aside className="hidden w-64 flex-col border-r border-sidebar-border bg-sidebar md:flex shadow-sm">
        {sidebarContent}
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        {/* Top Header Bar */}
        <header className="h-16 flex-none flex items-center justify-between border-b border-border bg-card px-4 md:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <SheetTrigger asChild className="md:hidden">
              <button
                className="p-2 text-muted-foreground hover:bg-accent transition-colors rounded-lg"
                aria-label="Open navigation menu"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
              <PageIcon className="h-4 w-4 text-[#00B8FF]" />
              <span className="font-medium text-foreground">{pageTitle}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setIsDark(!isDark);
                setThemeToggleKey((k) => k + 1);
              }}
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent transition-colors"
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              <span key={themeToggleKey} className="inline-block animate-theme-rotate">
                {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </span>
            </button>
            <button className="relative rounded-lg p-2 text-muted-foreground hover:bg-accent transition-colors">
              <BellRing className="h-5 w-5" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#00B8FF] ring-2 ring-background" />
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#00B8FF] to-[#0099D9] text-sm font-medium text-white shadow-sm">
              {user?.email?.charAt(0).toUpperCase() || "U"}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
    </Sheet>
  );
}
