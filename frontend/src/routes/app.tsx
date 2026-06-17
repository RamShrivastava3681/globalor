import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  LayoutDashboard, FileText, BellRing, LogOut, Settings, Shield, Building2, Truck, ShoppingCart, Receipt, Banknote, ClipboardCheck, Boxes, Wallet, FileSignature, Search, User
} from "lucide-react";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading, isAdmin, isTreasury, isChecker, isOperations, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  // Role-based route wall
  useEffect(() => {
    if (loading || !user) return;
    const treasuryBlocked = ["/app/invoices", "/app/purchases", "/app/expenses", "/app/checker", "/app/debtors", "/app/inventory", "/app/proformas", "/app/suppliers", "/app/admin"];
    const checkerBlocked = ["/app/expenses", "/app/queue", "/app/inventory", "/app/advances", "/app/proformas", "/app/debtors", "/app/suppliers", "/app/admin"];
    const operationsBlocked: string[] = []; // operations can access everything
    if (isTreasury && !isAdmin && !isChecker && treasuryBlocked.some((p) => pathname.startsWith(p))) {
      navigate({ to: "/app/queue" });
    }
    if (isChecker && !isAdmin && !isTreasury && checkerBlocked.some((p) => pathname.startsWith(p))) {
      navigate({ to: "/app/checker" });
    }
  }, [loading, user, isTreasury, isChecker, isOperations, isAdmin, pathname, navigate]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="text-sm text-muted-foreground">Opening portal…</div>
      </div>
    );
  }

  // Treasury gets a focused view; checker gets the review desk;
  // operations & admin see the full workspace; client sees their trading workspace
  const nav = isTreasury && !isAdmin && !isChecker
    ? [
        { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { to: "/app/queue", label: "Funding queue", icon: Banknote },
        { to: "/app/advances", label: "Advances", icon: Wallet },
        { to: "/app/alerts", label: "Alerts", icon: BellRing },
        { to: "/app/settings", label: "Settings", icon: Settings },
      ]
    : isChecker && !isAdmin
    ? [
        { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { to: "/app/checker", label: "Checker desk", icon: ClipboardCheck },
        { to: "/app/invoices", label: "Sales invoices", icon: FileText },
        { to: "/app/purchases", label: "Purchases", icon: ShoppingCart },
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
        { to: "/app/expenses", label: "Expenses", icon: Receipt },
        { to: "/app/advances", label: "Advances", icon: Wallet },
        { to: "/app/inventory", label: "Inventory", icon: Boxes },
        { to: "/app/debtors", label: "Debtors", icon: Building2 },
        { to: "/app/suppliers", label: "Suppliers", icon: Truck },
        { to: "/app/alerts", label: "Alerts", icon: BellRing },
        ...(isAdmin ? [
          { to: "/app/admin", label: "Operations", icon: Shield },
        ] : []),
        { to: "/app/settings", label: "Settings", icon: Settings },
      ];

  const consoleLabel = isAdmin ? "Factor console" : isOperations ? "Operations desk" : isTreasury ? "Treasury desk" : isChecker ? "Checker desk" : "Trading portal";

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden w-64 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex items-center gap-3 p-6 border-b border-sidebar-border">
          <img src="/logo.png" alt="Globalor Limited" className="h-10 w-auto object-contain bg-white p-1 rounded-md" />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{consoleLabel}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-4 overflow-y-auto">
          {nav.map((n) => {
            const active = pathname === n.to || pathname.startsWith(n.to + "/");
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-all duration-200 ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-[3px] border-primary"
                    : "text-sidebar-foreground/70 hover:bg-[rgba(56,189,248,0.08)] hover:text-foreground border-l-[3px] border-transparent"
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? "text-primary" : ""}`} />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <div className="rounded-lg bg-card/40 p-4 border border-border/50 backdrop-blur-sm">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Signed in as</div>
            <div className="truncate text-sm font-medium text-foreground">{user?.email}</div>
            <button onClick={signOut} className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        {/* Top Command Center Header */}
        <header className="h-16 flex-none flex items-center justify-between border-b border-border px-6 md:px-10 bg-[linear-gradient(90deg,rgba(0,191,255,0.08),transparent)]">
          <div className="flex items-center gap-4">
            <span className="hidden md:inline-flex rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-[10px] text-primary font-medium tracking-[0.2em] uppercase">Trading Portal</span>
            <div className="relative hidden md:block ml-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input type="text" placeholder="Search network..." className="h-9 w-64 rounded-full border border-border bg-black/20 pl-9 pr-4 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors">
              <BellRing className="h-5 w-5" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary animate-pulse" />
            </button>
            <div className="h-8 w-8 rounded-full bg-card border border-border flex items-center justify-center text-sm font-medium overflow-hidden">
              <User className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
