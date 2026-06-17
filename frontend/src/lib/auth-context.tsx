import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { api, getToken, setToken, clearToken } from "./api-client";

export type AppRole = "client" | "factor_admin" | "treasury" | "checker" | "operations";

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
  | "checker-desk"
  | "funding-queue"
  | "upload"
  | "admin";

// Permission map mirrors the backend
export const roleWritePermissions: Record<AppRole, WriteResource[] | ["*"]> = {
  factor_admin: ["*"],
  operations: [
    "suppliers", "debtors", "invoices", "purchase-invoices",
    "purchase-orders", "stock-movements", "advances", "expenses", "vendors",
  ],
  checker: ["checker-desk"],
  treasury: ["funding-queue"],
  client: [],
};

type AuthState = {
  user: { id: string; email: string } | null;
  roles: AppRole[];
  loading: boolean;
  isAdmin: boolean;
  isTreasury: boolean;
  isChecker: boolean;
  isOperations: boolean;
  isClient: boolean;
  canWrite: (resource: WriteResource) => boolean;
  refreshRoles: () => Promise<void>;
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | undefined>(undefined);

type MeResponse = {
  id: string;
  email: string;
  company_name: string;
  contact_name: string | null;
  roles: AppRole[];
};

async function fetchMe(): Promise<MeResponse | null> {
  try {
    return await api.get<MeResponse>("/auth/me");
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();
  const router = useRouter();

  const loadSession = async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setRoles([]);
      setLoading(false);
      return;
    }

    const me = await fetchMe();
    if (me) {
      setUser({ id: me.id, email: me.email });
      setRoles(me.roles);
    } else {
      clearToken();
      setUser(null);
      setRoles([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadSession();
  }, []);

  const refreshRoles = async () => {
    const me = await fetchMe();
    if (me) {
      setRoles(me.roles);
    }
  };

  const handleSignOut = async () => {
    qc.clear();
    clearToken();
    setUser(null);
    setRoles([]);
    router.navigate({ to: "/auth", replace: true });
  };

  const refreshSession = async () => {
    setLoading(true);
    await loadSession();
  };

  const  isAdmin = roles.includes("factor_admin");
  const isTreasury = roles.includes("treasury");
  const isChecker = roles.includes("checker");
  const isOperations = roles.includes("operations");
  const isClient = roles.includes("client") || (!isAdmin && !isTreasury && !isChecker && !isOperations);

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
    isTreasury,
    isChecker,
    isOperations,
    isClient,
    canWrite,
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
