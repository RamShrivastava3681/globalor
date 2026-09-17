import { Link, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  BarChart3,
  BellRing,
  Briefcase,
  Building2,
  ClipboardCheck,
  LayoutDashboard,
  ListTodo,
  Mail,
  Monitor,
  Moon,
  Package,
  Palette,
  Settings,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Sun,
  Truck,
  Users,
  Wallet,
  Warehouse,
  ChevronDown,
  FileText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAppearance, type Appearance } from "@/hooks/use-appearance";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_META: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/tasks", label: "My Queue", icon: ListTodo },
  { to: "/app/workspace", label: "My Workspace", icon: Briefcase },
  { to: "/app/checker", label: "Checker", icon: ClipboardCheck },
  { to: "/app/finance-workbench", label: "Finance", icon: Wallet },
  { to: "/app/procurement-workbench", label: "Procurement", icon: ShoppingCart },
  { to: "/app/sales-workbench", label: "Sales", icon: ShoppingBag },
  { to: "/app/crm", label: "Leads", icon: Users },
  { to: "/app/naughty-list", label: "Naughty List", icon: AlertTriangle },
  { to: "/app/debtors", label: "Customers", icon: Building2 },
  { to: "/app/suppliers", label: "Suppliers", icon: Truck },
  { to: "/app/products", label: "Product Catalogue", icon: Package },
  { to: "/app/warehouse-workbench", label: "Warehouse Control", icon: Warehouse },
  { to: "/app/warehouse", label: "Warehouse", icon: Warehouse },
  { to: "/app/reports", label: "Reports", icon: BarChart3 },
  { to: "/app/my-reports", label: "My Reports", icon: Users },
  { to: "/app/alerts", label: "Alerts", icon: BellRing },
  { to: "/app/reminders", label: "Reminders", icon: Mail },
  { to: "/app/admin", label: "Operations", icon: Shield },
  { to: "/app/template", label: "Invoice template", icon: Palette },
  { to: "/app/settings", label: "Settings", icon: Settings },
  { to: "/app/queue", label: "Funding queue", icon: Wallet },
  { to: "/app/invoices", label: "Sales invoices", icon: FileText },
  { to: "/app/challan", label: "Challan", icon: FileText },
  { to: "/app/invoice-preview", label: "Invoice", icon: FileText },
  { to: "/app/note-preview", label: "Credit / Debit note", icon: FileText },
];

function currentPage(pathname: string) {
  if (pathname.startsWith("/app/challan/")) return PAGE_META.find((p) => p.to === "/app/challan");
  if (pathname.startsWith("/app/invoice-preview/")) return PAGE_META.find((p) => p.to === "/app/invoice-preview");
  if (pathname.startsWith("/app/note-preview/")) return PAGE_META.find((p) => p.to === "/app/note-preview");
  const exact = PAGE_META.find((p) => pathname === p.to);
  if (exact) return exact;
  const prefix = PAGE_META.filter((p) => p.to !== "/app/reports").find((p) => pathname.startsWith(p.to + "/"));
  return prefix;
}

export function AppTopbar({ alertCount = 0 }: { alertCount?: number }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, signOut } = useAuth();
  const { appearance, setAppearance, resolvedTheme } = useAppearance();
  const page = currentPage(pathname);

  const appearanceOptions: { value: Appearance; label: string; icon: LucideIcon }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  const email = user?.email ?? "";
  const namePrefix = email.split("@")[0] ?? "U";
  const initial = (email.charAt(0) || "U").toUpperCase();

  return (
    <div className="sticky top-3 z-30 hidden px-4 md:block">
      <header className="flex h-16 items-center justify-between rounded-2xl border border-[#e5ebf2] bg-white px-4 shadow-[0_8px_28px_-12px_rgba(10,34,57,0.18)] dark:bg-sidebar dark:border-sidebar-border">
        <div className="flex min-w-0 items-center">
          {page && (
            <span className="hidden h-9 items-center gap-2 rounded-[10px] bg-[#eef7ff] px-3 text-[13px] font-semibold text-[#0067c2] lg:inline-flex">
              <page.icon className="h-4 w-4" strokeWidth={1.8} />
              {page.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Link
            to="/app/alerts"
            aria-label="Alerts"
            className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"
          >
            <BellRing className="h-5 w-5" strokeWidth={1.8} />
            {alertCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#e5484d] px-1 text-[10px] font-bold text-white">
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent" aria-label="Change appearance">
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

          <span className="mx-2 h-6 w-px bg-[#e5ebf2]" aria-hidden />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-accent" aria-label="Account menu">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eef7ff] text-sm font-bold text-[#0067c2]">
                  {initial}
                </span>
                <span className="hidden max-w-[110px] truncate text-sm font-medium text-foreground xl:block">{namePrefix}</span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground xl:block" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/app/settings">Profile</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/app/workspace">My Workspace</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/app/settings">Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void signOut()} className="text-destructive focus:text-destructive">
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </div>
  );
}
