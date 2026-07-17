import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  LayoutDashboard, FileText, BellRing, LogOut, Settings, Shield, Building2, Truck, ShoppingCart, Receipt, Banknote, ClipboardCheck, Boxes, Wallet, FileSignature, User, BarChart3, ScrollText, Menu, X, Search, ChevronRight
} from "lucide-react";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading, isAdmin, isTreasury, isChecker, isOperations, isViewer, isSuperAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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
      <div className="grid min-h-screen place-items-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#00B8FF] border-t-transparent" />
          <div className="text-sm text-[#64748B]">Opening portal…</div>
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
        { to: "/app/inventory", label: "Inventory", icon: Boxes },
        { to: "/app/debtors", label: "Debtors", icon: Building2 },
        { to: "/app/vendors", label: "Suppliers", icon: Truck },
        { to: "/app/credit-debit-notes", label: "Credit/Debit notes", icon: ScrollText },
        { to: "/app/alerts", label: "Alerts", icon: BellRing },
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
        { to: "/app/inventory", label: "Inventory", icon: Boxes },
        { to: "/app/debtors", label: "Debtors", icon: Building2 },
        { to: "/app/vendors", label: "Suppliers", icon: Truck },
        { to: "/app/credit-debit-notes", label: "Credit/Debit notes", icon: ScrollText },
        { to: "/app/alerts", label: "Alerts", icon: BellRing },
        ...(isSuperAdmin ? [{ to: "/app/admin", label: "Operations", icon: Shield }] : []),
        { to: "/app/settings", label: "Settings", icon: Settings },
      ];

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-[#E2E8F0]">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#00B8FF] to-[#0099D9] shadow-sm">
          <span className="text-sm font-bold text-white">G</span>
        </div>
        <div>
          <div className="text-sm font-bold text-[#0F172A]">Globalor</div>
          <div className="text-[10px] text-[#64748B] tracking-wide">Trade Finance OS</div>
        </div>
      </div>

      {/* Navigation */}
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
                  ? "bg-[#F0F9FF] text-[#0F172A] shadow-sm"
                  : "text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 transition-colors ${
                active ? "text-[#00B8FF]" : "text-[#94A3B8] group-hover:text-[#64748B]"
              }`} />
              <span>{n.label}</span>
              {active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#00B8FF]" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-[#E2E8F0] p-4">
        <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E2E8F0] text-sm font-medium text-[#64748B]">
              {user?.email?.charAt(0).toUpperCase() || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-[#0F172A] truncate">{user?.email}</div>
              <div className="text-[10px] text-[#64748B]">
                {isAdmin ? "Admin" : isTreasury ? "Treasury" : isChecker ? "Checker" : isViewer ? "Viewer" : isOperations ? "Operations" : "User"}
              </div>
            </div>
          </div>
          <button onClick={signOut} className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs text-[#64748B] hover:bg-[#FEF2F2] hover:text-[#DC2626] hover:border-[#FECACA] transition-colors">
            <LogOut className="h-3 w-3" />
            Sign out
          </button>
        </div>
      </div>
    </>
  );

  // Get current page title for header
  const currentNav = nav.find((n) => pathname === n.to || pathname.startsWith(n.to + "/"));
  const pageTitle = currentNav?.label || "Dashboard";
  const PageIcon = currentNav?.icon || LayoutDashboard;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F8FAFC]">
      {/* Mobile sidebar */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setMobileSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 bg-white border-r border-[#E2E8F0] shadow-xl overflow-y-auto">
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden w-64 flex-col border-r border-[#E2E8F0] bg-white md:flex shadow-sm">
        {sidebarContent}
      </aside>

      {/* Main content area */}
      <main className="flex-1 min-w-0 flex flex-col bg-[#F8FAFC]">
        {/* Top Header Bar */}
        <header className="h-16 flex-none flex items-center justify-between border-b border-[#E2E8F0] bg-white px-4 md:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="inline-flex items-center justify-center rounded-lg p-2 text-[#64748B] hover:bg-[#F1F5F9] transition-colors md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden md:flex items-center gap-2 text-sm text-[#64748B]">
              <PageIcon className="h-4 w-4 text-[#00B8FF]" />
              <span className="font-medium text-[#0F172A]">{pageTitle}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8]" />
              <input
                type="text"
                placeholder="Search..."
                className="h-9 w-56 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-9 pr-3 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#00B8FF] focus:outline-none focus:ring-1 focus:ring-[#00B8FF]/20 transition-all"
              />
            </div>
            <button className="relative rounded-lg p-2 text-[#64748B] hover:bg-[#F1F5F9] transition-colors">
              <BellRing className="h-5 w-5" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#00B8FF] ring-2 ring-white" />
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#00B8FF] to-[#0099D9] text-sm font-medium text-white shadow-sm">
              {user?.email?.charAt(0).toUpperCase() || "U"}
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
