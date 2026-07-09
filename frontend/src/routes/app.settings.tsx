import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card } from "@/components/ledger-ui";
import { Shield, Loader2, Plus, Users, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

const ALL_ROLES = [
  { value: "client", label: "Client", desc: "Submit invoices and monitor status" },
  { value: "operations", label: "Operations", desc: "Read everything, write to most operational resources" },
  { value: "checker", label: "Checker", desc: "Read everything, approve/reject invoices" },
  { value: "treasury", label: "Treasury", desc: "Read everything, manage funding queue" },
  { value: "factor_admin", label: "Admin", desc: "Full access to everything" },
  { value: "viewer", label: "Viewer", desc: "Read-only access to all data — cannot create, edit, or delete" },
] as const;

function SettingsPage() {
  const { user, isAdmin, refreshRoles } = useAuth();
  const [profile, setProfile] = useState({ company_name: "", contact_name: "" });
  const [loading, setLoading] = useState(false);

  // User management state
  const [users, setUsers] = useState<Array<{ id: string; email: string; company_name: string; roles: string[] }>>([]);
  const [rolesData, setRolesData] = useState<Array<{ user_id: string; role: string }>>([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", password: "", company_name: "", contact_name: "", role: "operations" });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.get<any>("/profiles/me").then((data) => {
      if (data) setProfile({ company_name: data.company_name ?? "", contact_name: data.contact_name ?? "" });
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!isAdmin) return;
    loadUsers();
  }, [isAdmin]);

  const loadUsers = async () => {
    try {
      const [profiles, roles] = await Promise.all([
        api.get<any[]>("/admin/profiles"),
        api.get<any[]>("/admin/roles"),
      ]);
      setUsers((profiles ?? []).map((p: any) => ({
        id: p.id,
        email: p.email ?? "",
        company_name: p.company_name ?? "",
        roles: [] as string[],
      })));
      setRolesData(roles ?? []);

      // Merge roles into users
      const roleMap: Record<string, string[]> = {};
      for (const r of roles ?? []) {
        if (!roleMap[r.user_id]) roleMap[r.user_id] = [];
        roleMap[r.user_id].push(r.role);
      }
      setUsers((prev) => prev.map((u) => ({ ...u, roles: roleMap[u.id] ?? [] })));
    } catch {}
  };

  const save = async () => {
    setLoading(true);
    try {
      await api.patch("/profiles/me", profile);
      toast.success("Profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const createUser = async () => {
    if (!newUser.email || !newUser.password || !newUser.company_name) {
      toast.error("Email, password, and company name are required");
      return;
    }
    setCreating(true);
    try {
      await api.post("/admin/users", newUser);
      toast.success(`User ${newUser.email} created with role: ${newUser.role}`);
      setShowCreateUser(false);
      setNewUser({ email: "", password: "", company_name: "", contact_name: "", role: "operations" });
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const toggleRole = async (userId: string, role: string, add: boolean) => {
    try {
      await api.post("/admin/roles", { user_id: userId, role, add });
      await loadUsers();
      toast.success(`Role ${add ? "added" : "removed"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Account" title="Settings" />
      <div className="grid gap-6 p-6 md:grid-cols-2 md:p-10">
        <Card title="Company profile">
          <div className="space-y-3">
            <L label="Company name"><input className="inp" value={profile.company_name} onChange={(e) => setProfile({ ...profile, company_name: e.target.value })} /></L>
            <L label="Contact name"><input className="inp" value={profile.contact_name} onChange={(e) => setProfile({ ...profile, contact_name: e.target.value })} /></L>
            <L label="Email"><input className="inp" value={user?.email ?? ""} disabled /></L>
            <button onClick={save} disabled={loading} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </div>
        </Card>

        <Card title="Access level">
          <div className="flex items-start gap-3">
            <Shield className="mt-1 h-5 w-5 text-primary" />
            <div className="flex-1">
              <div className="font-medium">{isAdmin ? "Factor admin" : "Client"}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {isAdmin
                  ? "You can view every client's invoices, manage debtors, approve advances, and issue alerts."
                  : "You can submit invoices for your company and monitor their status."}
              </p>
            </div>
          </div>
        </Card>

        {/* Admin: User management */}
        {isAdmin && (
          <div className="md:col-span-2">
            <Card title="User management">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Manage user roles and create new accounts.</p>
                  <button onClick={() => setShowCreateUser(!showCreateUser)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
                    <Plus className="h-3.5 w-3.5" /> New user
                  </button>
                </div>

                {showCreateUser && (
                  <div className="rounded-lg border border-border bg-background/40 p-4">
                    <h4 className="mb-3 text-sm font-medium">Create user</h4>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <L label="Email">
                        <input className="inp" type="email" value={newUser.email}
                          onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="user@company.com" />
                      </L>
                      <L label="Password">
                        <input className="inp" type="password" value={newUser.password}
                          onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="Minimum 6 characters" />
                      </L>
                      <L label="Company name">
                        <input className="inp" value={newUser.company_name}
                          onChange={(e) => setNewUser({ ...newUser, company_name: e.target.value })} placeholder="Acme Corp" />
                      </L>
                      <L label="Role">
                        <select className="inp" value={newUser.role}
                          onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                          {ALL_ROLES.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </L>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <button onClick={() => setShowCreateUser(false)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs">Cancel</button>
                      <button onClick={createUser} disabled={creating}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60">
                        {creating && <Loader2 className="h-3 w-3 animate-spin" />}
                        Create user
                      </button>
                    </div>
                  </div>
                )}

                {users.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    <Users className="mx-auto mb-2 h-6 w-6 opacity-40" />
                    No users found
                  </div>
                ) : (
                  <div className="-mx-5 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                        <tr className="border-b border-border">
                          <th className="px-5 py-2 text-left font-normal">Email</th>
                          <th className="px-5 py-2 text-left font-normal">Company</th>
                          <th className="px-5 py-2 text-left font-normal">Roles</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={u.id} className="border-b border-border/60">
                            <td className="px-5 py-3">{u.email}</td>
                            <td className="px-5 py-3 text-muted-foreground">{u.company_name}</td>
                            <td className="px-5 py-3">
                              <div className="flex flex-wrap gap-1.5">
                                {ALL_ROLES.map((r) => {
                                  const hasRole = u.roles.includes(r.value);
                                  return (
                                    <button
                                      key={r.value}
                                      title={r.desc}
                                      onClick={() => toggleRole(u.id, r.value, !hasRole)}
                                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest transition ${
                                        hasRole
                                          ? "bg-primary/15 text-primary"
                                          : "border border-border text-muted-foreground hover:border-muted-foreground"
                                      }`}
                                    >
                                      {hasRole ? <X className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
                                      {r.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
      <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}.inp:disabled{opacity:.6}`}</style>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
