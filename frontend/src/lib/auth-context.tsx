import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  api,
  getToken,
  setToken,
  clearToken,
  setCompanyOverride,
  broadcastSignOut,
  SIGNOUT_MARKER_KEY,
} from "./api-client";

export type AppRole = "client" | "factor_admin" | "treasury" | "checker" | "operations" | "viewer";

// Resource names used with canWrite() — matches backend permission resources
export type WriteResource =
  | "suppliers"
  | "debtors"
  | "invoices"
  | "purchase-invoices"
  | "purchase-orders"
  | "stock-movements"
  | "advances"
  | "expenses"
  | "vendors"
  | "products"
  | "goods-purchase-orders"
  | "goods-sales-orders"
  | "quotations"
  | "checker-desk"
  | "funding-queue"
  | "upload"
  | "admin";

// Permission map mirrors the backend
export const roleWritePermissions: Record<AppRole, readonly (WriteResource | "*")[]> = {
  factor_admin: ["*"],
  operations: [
    "suppliers", "debtors", "invoices", "purchase-invoices",
    "purchase-orders", "stock-movements", "advances", "expenses",    "vendors",
    "products",
    "goods-purchase-orders",
    "goods-sales-orders",
    "quotations",
  ],
  checker: ["checker-desk"],
  treasury: ["funding-queue"],
  // Clients maintain their own product catalogue and place their own
  // purchase orders + goods receipts (maker model).
  client: ["products", "goods-purchase-orders", "goods-sales-orders", "quotations"],
  viewer: [],
};

type ImpersonatedCompany = {
  id: string;
  name: string;
};

type AuthState = {
  user: { id: string; email: string } | null;
  roles: AppRole[];
  loading: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isTreasury: boolean;
  isChecker: boolean;
  isOperations: boolean;
  isViewer: boolean;
  isClient: boolean;
  canWrite: (resource: WriteResource) => boolean;
  company_id: string | null;
  company_name: string;
  /** The effective company being viewed — overridden for super admins */
  effectiveCompanyId: string | null;
  effectiveCompanyName: string;
  impersonatedCompany: ImpersonatedCompany | null;
  setImpersonatedCompany: (company: ImpersonatedCompany | null) => void;
  refreshRoles: () => Promise<void>;
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | undefined>(undefined);

type MeResponse = {
  id: string;
  email: string;
  company_id: string | null;
  company_name: string;
  contact_name: string | null;
  roles: AppRole[];
  is_super_admin?: boolean;
};

type MeResult =
  | { status: "ok"; me: MeResponse }
  | { status: "logged_out" } // 401/403 — token invalid or expired
  | { status: "transient" }; // 429/5xx/network — keep the current session

async function fetchMe(): Promise<MeResult> {
  try {
    const me = await api.get<MeResponse>("/auth/me");
    return { status: "ok", me };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 401 || status === 403) return { status: "logged_out" };
    // A rate-limit or server error must NOT log the user out — clearing a
    // still-valid token here is what made simultaneous logins look like a
    // race condition (login succeeds, then the user is silently kicked out).
    return { status: "transient" };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [impersonatedCompany, setImpersonatedCompany] = useState<ImpersonatedCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();
  const router = useRouter();
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Always-current user identity, so the cross-tab sign-out listener can
  // compare against the latest session without re-subscribing.
  const userRef = useRef<{ id: string; email: string } | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // ── Heartbeat ping ──
  // Send a periodic ping to update the user's last_seen_at timestamp
  // Frequent pings give other admins near-real-time online status
  const sendPing = async () => {
    try {
      await api.post("/auth/ping");
    } catch {
      // Silently ignore ping failures
    }
  };

  const startPing = () => {
    stopPing();
    // Send first ping immediately so the user shows Online right away
    sendPing();
    pingIntervalRef.current = setInterval(sendPing, 10_000); // Every 10 seconds
  };

  const stopPing = () => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  };

  const loadSession = async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setRoles([]);
      setIsSuperAdmin(false);
      setCompanyId(null);
      setCompanyName("");
      setImpersonatedCompany(null);
      stopPing();
      setLoading(false);
      return;
    }

    let result = await fetchMe();
    if (result.status === "transient") {
      // Retry once — transient failures (rate limit / server hiccup) usually
      // clear immediately, and a valid session shouldn't bounce to the login
      // page because of one blip.
      await new Promise((r) => setTimeout(r, 1000));
      result = await fetchMe();
    }
    if (result.status === "ok") {
      const me = result.me;
      setUser({ id: me.id, email: me.email });
      setRoles(me.roles);
      setCompanyId(me.company_id ?? null);
      setCompanyName(me.company_name ?? "");
      setIsSuperAdmin(!!me.is_super_admin);
      startPing();
    } else if (result.status === "logged_out") {
      // Token is genuinely invalid/expired — end the session
      clearToken();
      setUser(null);
      setRoles([]);
      setCompanyId(null);
      setCompanyName("");
      setIsSuperAdmin(false);
      setImpersonatedCompany(null);
      stopPing();
    }
    // transient → keep whatever session state we have; never clear a valid token
    setLoading(false);
  };

  useEffect(() => {
    loadSession();
    return () => stopPing();
  }, []);

  const refreshRoles = async () => {
    const result = await fetchMe();
    if (result.status === "ok") {
      setRoles(result.me.roles);
    }
  };

  const handleSignOut = async () => {
    // Send a final ping so other users see this user as "Offline" instantly
    try {
      await api.post("/auth/ping");
    } catch {
      // Best-effort
    }
    stopPing();
    qc.clear();
    // Broadcast so other tabs logged in as the SAME user sign out too
    broadcastSignOut({ email: userRef.current?.email ?? null });
    clearToken();
    setUser(null);
    setRoles([]);
    setCompanyId(null);
    setCompanyName("");
    setImpersonatedCompany(null);
    router.navigate({ to: "/auth", replace: true });
  };

  // Cross-tab sign-out: if another tab broadcasts a sign-out for the user
  // this tab is logged in as, clear this tab's session as well.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SIGNOUT_MARKER_KEY || !e.newValue) return;
      try {
        const marker = JSON.parse(e.newValue) as {
          email?: string | null;
          at?: number;
        };
        if (
          marker.email &&
          userRef.current?.email &&
          userRef.current.email === marker.email
        ) {
          stopPing();
          qc.clear();
          clearToken();
          setUser(null);
          setRoles([]);
          setCompanyId(null);
          setCompanyName("");
          setImpersonatedCompany(null);
          router.navigate({ to: "/auth", replace: true });
        }
      } catch {
        // Ignore malformed markers
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleSetImpersonatedCompany = (company: ImpersonatedCompany | null) => {
    setImpersonatedCompany(company);
    setCompanyOverride(company?.id ?? null);
  };

  const refreshSession = async () => {
    setLoading(true);
    await loadSession();
  };

  // Effective company — overridden for super admins, else the user's own company
  const effectiveCompanyId = impersonatedCompany?.id ?? companyId;
  const effectiveCompanyName = impersonatedCompany?.name ?? companyName;

  const isAdmin = roles.includes("factor_admin");
  const isTreasury = roles.includes("treasury");
  const isChecker = roles.includes("checker");
  const isOperations = roles.includes("operations");
  const isViewer = roles.includes("viewer");
  const isClient = roles.includes("client") || (!isAdmin && !isTreasury && !isChecker && !isOperations && !isViewer);

  // Check if the user has write access to a specific resource
  const canWrite = (resource: WriteResource): boolean => {
    for (const role of roles) {
      const perms = roleWritePermissions[role];
      if (perms.includes("*")) return true;
      if (perms.includes(resource)) return true;
    }
    return false;
  };

  const value: AuthState = {
    user,
    roles,
    loading,
    isAdmin,
    isSuperAdmin,
    isTreasury,
    isChecker,
    isOperations,
    isViewer,
    isClient,
    canWrite,
    company_id: companyId,
    company_name: companyName,
    effectiveCompanyId,
    effectiveCompanyName,
    impersonatedCompany,
    setImpersonatedCompany: handleSetImpersonatedCompany,
    refreshRoles,
    refreshSession,
    signOut: handleSignOut,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
