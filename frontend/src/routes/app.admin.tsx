import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Zap, Shield, Trash2, AlertTriangle, UserPlus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin")({
  component: AdminPage,
});

const AVAILABLE_ROLES = [
  "client",
  "factor_admin",
  "treasury",
  "checker",
  "operations",
  "viewer",
] as const;

// ── Helpers for online status ──
function formatTime(date: Date): string {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const isThisYear = date.getFullYear() === now.getFullYear();

  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });

  if (isToday) {
    return time;
  }

  const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });
  if (isThisYear) {
    return `${dateStr}, ${time}`;
  }

  return `${date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}, ${time}`;
}

function getOnlineStatus(lastSeenAt: string | null): { label: string; color: string; dotColor: string } {
  if (!lastSeenAt) {
    return { label: "Never seen", color: "text-muted-foreground", dotColor: "bg-muted-foreground" };
  }

  const now = Date.now();
  const lastSeen = new Date(lastSeenAt).getTime();
  const diffMinutes = (now - lastSeen) / (1000 * 60);

  // Show "Online" with green dot for users active in the last 5 minutes
  if (diffMinutes < 5) {
    return { label: "Online", color: "text-emerald-600", dotColor: "bg-emerald-500" };
  }

  // For everyone else, show the actual last seen timestamp
  const formatted = formatTime(new Date(lastSeenAt));
  return { label: `Seen ${formatted}`, color: "text-muted-foreground", dotColor: "bg-muted-foreground/50" };
}

function AdminPage() {
  const { isAdmin, isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ── Create user form state ──
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    company_name: "",
    contact_name: "",
    role: "client" as string,
  });

  const invoicesQ = useQuery({
    queryKey: ["invoices-admin"],
    queryFn: async () => (await api.get<any[]>("/invoices")) ?? [],
    enabled: isAdmin,
  });

  const debtorsQ = useQuery({
    queryKey: ["debtors-admin"],
    queryFn: async () => (await api.get<any[]>("/debtors")) ?? [],
    enabled: isAdmin,
  });

  const profilesQ = useQuery({
    queryKey: ["profiles-admin"],
    queryFn: async () => {
      const data = await api.get<any[]>("/admin/profiles");
      return data ?? [];
    },
    enabled: isAdmin,
    refetchInterval: 10_000, // Auto-refresh every 10s for live online status
  });

  const rolesQ = useQuery({
    queryKey: ["user_roles-admin"],
    queryFn: async () => {
      const data = await api.get<any[]>("/admin/roles");
      return data ?? [];
    },
    enabled: isAdmin,
  });

  const toggleRole = useMutation({
    mutationFn: async ({ user_id, role, add }: { user_id: string; role: string; add: boolean }) => {
      await api.post("/admin/roles", { user_id, role, add });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["user_roles-admin"] }); toast.success("Role updated"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const generateAlerts = useMutation({
    mutationFn: async () => {
      const result = await api.post<{ created: number }>("/admin/generate-alerts");
      return result.created;
    },
    onSuccess: (n) => { qc.invalidateQueries({ queryKey: ["alerts"] }); toast.success(`Generated ${n} alerts`); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const createUser = useMutation({
    mutationFn: async (data: typeof newUser) => {
      return api.post("/admin/users", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles-admin"] });
      qc.invalidateQueries({ queryKey: ["user_roles-admin"] });
      toast.success("User created successfully");
      setShowCreateUser(false);
      setNewUser({ email: "", password: "", company_name: "", contact_name: "", role: "client" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      return api.delete(`/admin/users/${userId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles-admin"] });
      qc.invalidateQueries({ queryKey: ["user_roles-admin"] });
      toast.success("User deleted");
      setDeleteConfirmId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (!isAdmin) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-center"><div className="text-sm text-muted-foreground">Factor admin only.</div></div>
      </div>
    );
  }

  const invoices = invoicesQ.data ?? [];
  const tot = (st: string[]) => invoices.filter((i: any) => st.includes(i.status)).reduce((s: number, i: any) => s + Number(i.amount), 0);

  const profiles = profilesQ.data ?? [];
  const roles = rolesQ.data ?? [];
  const rolesByUser = new Map<string, string[]>();
  roles.forEach((r: any) => {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r.role);
    rolesByUser.set(r.user_id, arr);
  });

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Risk & operations console"
        description="Generate alerts, manage team roles, and act on exceptions."
        actions={
          <div className="flex items-center gap-2">
            {isSuperAdmin && (
              <button onClick={() => setShowCreateUser(true)}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                <UserPlus className="h-4 w-4" /> Create user
              </button>
            )}
            <button onClick={() => generateAlerts.mutate()} disabled={generateAlerts.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-muted px-4 py-2 text-sm font-medium text-foreground border border-border hover:bg-muted/80 transition-colors disabled:opacity-60">
              <Zap className="h-4 w-4" /> Run monitoring scan
            </button>
          </div>
        }
      />

      {/* ── Create User Dialog ── */}
      <Dialog open={showCreateUser} onOpenChange={setShowCreateUser}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create new user</DialogTitle>
            <DialogDescription>
              Only the main administrator can create users. The user will receive a welcome email with their credentials.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createUser.mutate(newUser);
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Email</label>
              <input
                type="email"
                required
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
                placeholder="user@company.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
                placeholder="Min 6 characters"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Company name</label>
              <input
                type="text"
                required
                value={newUser.company_name}
                onChange={(e) => setNewUser({ ...newUser, company_name: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
                placeholder="Acme Corp"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Contact name</label>
              <input
                type="text"
                value={newUser.contact_name}
                onChange={(e) => setNewUser({ ...newUser, contact_name: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
                placeholder="John Doe"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Role</label>
              <select
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
              >
                {AVAILABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateUser(false)}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createUser.isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {createUser.isPending ? "Creating…" : "Create user"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Delete user
            </DialogTitle>
            <DialogDescription>
              This will permanently delete this user and all associated data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDeleteConfirmId(null)}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (deleteConfirmId) deleteUser.mutate(deleteConfirmId);
              }}
              disabled={deleteUser.isPending}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-60"
            >
              {deleteUser.isPending ? "Deleting…" : "Delete user"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 p-6 md:grid-cols-4 md:p-10">
        <Card title="Pending review">
          <div className="num text-3xl">{invoices.filter((i: any) => i.status === "pending").length}</div>
          <div className="mt-1 text-xs text-muted-foreground">{fmtMoney(tot(["pending"]))}</div>
        </Card>
        <Card title="Approved (to fund)">
          <div className="num text-3xl text-primary">{invoices.filter((i: any) => i.status === "approved").length}</div>
          <div className="mt-1 text-xs text-muted-foreground">{fmtMoney(tot(["approved"]))}</div>
        </Card>
        <Card title="Funded">
          <div className="num text-3xl text-success">{invoices.filter((i: any) => i.status === "advanced").length}</div>
          <div className="mt-1 text-xs text-muted-foreground">{fmtMoney(tot(["advanced"]))}</div>
        </Card>
        <Card title="Overdue / rejected">
          <div className="num text-3xl text-destructive">{invoices.filter((i: any) => i.status === "overdue" || i.status === "rejected").length}</div>
          <div className="mt-1 text-xs text-muted-foreground">{fmtMoney(tot(["overdue", "rejected"]))}</div>
        </Card>
      </div>

      <div className="px-6 pb-10 md:px-10">
        <Card title="Team & roles" action={<span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Shield className="h-3 w-3" /> assign access</span>}>
          {profilesQ.isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : profiles.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No users yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-left font-normal">UID</th>
                    <th className="px-5 py-2 text-left font-normal">User</th>
                    <th className="px-5 py-2 text-left font-normal">Email</th>
                    <th className="px-5 py-2 text-left font-normal">Current roles</th>
                    <th className="px-5 py-2 text-right font-normal">Checker</th>
                    <th className="px-5 py-2 text-right font-normal">Treasury</th>
                    <th className="px-5 py-2 text-right font-normal">Factor admin</th>
                    {isSuperAdmin && <th className="px-5 py-2 text-right font-normal">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p: any) => {
                    const userRoles = rolesByUser.get(p.id) ?? [];
                    const hasChecker = userRoles.includes("checker");
                    const hasTreasury = userRoles.includes("treasury");
                    const hasAdmin = userRoles.includes("factor_admin");
                    return (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          {(() => {
                            const status = getOnlineStatus(p.last_seen_at);
                            return (
                              <span className={`inline-flex items-center gap-1.5 text-xs ${status.color}`}>
                                <span className={`h-2 w-2 rounded-full ${status.dotColor}`} />
                                {status.label}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-5 py-3 font-mono text-[10px] text-muted-foreground" title={p.id}>#{p.id.slice(-8).toUpperCase()}</td>
                        <td className="px-5 py-3">
                          <div>{p.contact_name || p.company_name || "—"}</div>
                          <div className="text-xs text-muted-foreground">{p.company_name}</div>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">{p.email}</td>
                        <td className="px-5 py-3">
                          {userRoles.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : userRoles.map((r) => (
                            <span key={r} className="mr-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-widest">{r}</span>
                          ))}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => toggleRole.mutate({ user_id: p.id, role: "checker", add: !hasChecker })}
                            className={`rounded-md border px-2.5 py-1 text-xs ${hasChecker ? "border-warning/50 bg-warning/10 text-warning" : "border-border text-muted-foreground hover:text-foreground"}`}>
                            {hasChecker ? "Revoke" : "Grant"}
                          </button>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => toggleRole.mutate({ user_id: p.id, role: "treasury", add: !hasTreasury })}
                            className={`rounded-md border px-2.5 py-1 text-xs ${hasTreasury ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                            {hasTreasury ? "Revoke" : "Grant"}
                          </button>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => toggleRole.mutate({ user_id: p.id, role: "factor_admin", add: !hasAdmin })}
                            className={`rounded-md border px-2.5 py-1 text-xs ${hasAdmin ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-border text-muted-foreground hover:text-foreground"}`}>
                            {hasAdmin ? "Revoke" : "Grant"}
                          </button>
                        </td>
                        {isSuperAdmin && (
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={() => setDeleteConfirmId(p.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
                              title="Delete user"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[10px] text-muted-foreground">Checkers approve newly submitted invoices into the funding queue (maker–checker). Treasury then pays supplier advances on approval, settles balances on the due date, and records debtor receipts. Marking an invoice paid closes it and removes it from the queue.</p>
        </Card>
      </div>
    </div>
  );
}
