import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader, StatusPill } from "@/components/ledger-ui";
import { SectionCard } from "@/components/workbench";
import { Briefcase, MapPin, Plane, Receipt, CalendarDays, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/workspace")({
  component: WorkspacePage,
});

type Req = { id: string; kind: string; title: string; detail: string; status: "pending" | "approved" | "rejected"; created: string };
const KEY = "whizunik-workspace-requests";

function load(): Req[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

const KIND_TABS = [
  { id: "visits", label: "Visits", icon: MapPin },
  { id: "travel", label: "Travel", icon: Plane },
  { id: "expenses", label: "Expenses", icon: Receipt },
  { id: "leave", label: "Leave", icon: CalendarDays },
];

function WorkspacePage() {
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const viewAsUserId = typeof search?.viewAsUserId === "string" ? search.viewAsUserId : undefined;
  const [tab, setTab] = useState("visits");
  const [items, setItems] = useState<Req[]>(load);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [mode, setMode] = useState<"mine" | "theirs">("mine");

  const persist = (next: Req[]) => {
    setItems(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const visible = useMemo(() => items.filter((i) => i.kind === tab), [items, tab]);
  const stats = useMemo(() => ({
    pending: items.filter((i) => i.status === "pending").length,
    approved: items.filter((i) => i.status === "approved").length,
    total: items.length,
  }), [items]);

  if (viewAsUserId) {
    return (
      <div>
        <PageHeader eyebrow="Workspace" title="Their workspace" description={`Read-only activity overview (viewing ${viewAsUserId}).`} />
        <div className="mt-4 flex gap-1.5 rounded-xl border border-border bg-card p-1.5">
          {(["mine", "theirs"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cn("flex-1 rounded-lg px-3 py-2 text-[13px] font-medium", mode === m ? "bg-white shadow-card dark:bg-card dark:text-foreground" : "text-muted-foreground")}>
              {m === "mine" ? "Their workspace" : "Activity overview"}
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <SectionCard title="Pending"><span className="num font-display text-3xl font-semibold">{stats.pending}</span></SectionCard>
          <SectionCard title="Approved"><span className="num font-display text-3xl font-semibold">{stats.approved}</span></SectionCard>
          <SectionCard title="Total"><span className="num font-display text-3xl font-semibold">{stats.total}</span></SectionCard>
        </div>
      </div>
    );
  }

  const submit = () => {
    if (!title.trim()) return;
    persist([{ id: crypto.randomUUID(), kind: tab, title: title.trim(), detail: detail.trim(), status: "pending", created: new Date().toISOString() }, ...items]);
    setTitle("");
    setDetail("");
    setFormOpen(false);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Personal"
        title={<span className="inline-flex items-center gap-2"><Briefcase className="h-5 w-5 text-primary" /> My Workspace</span>}
        description="Submit & track your requests."
      />
      <div className="mt-4 flex gap-1.5 overflow-x-auto rounded-xl border border-border bg-card p-1.5">
        {KIND_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setFormOpen(false); }}
            aria-pressed={tab === t.id}
            className={cn("inline-flex min-w-max flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium", tab === t.id ? "bg-white shadow-card dark:bg-card dark:text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        <button onClick={() => setFormOpen((v) => !v)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-[13px] font-semibold text-primary hover:bg-muted/50">
          <Plus className="h-4 w-4" /> New {KIND_TABS.find((t) => t.id === tab)?.label}
        </button>
        {formOpen && (
          <SectionCard title={`New ${tab} request`} className="mt-3">
            <div className="space-y-2.5">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Request title" className="h-9 w-full rounded-md border border-border px-2.5 text-sm" />
              <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Details (dates, amounts, reason…)" aria-label="Request details" className="min-h-20 w-full rounded-md border border-border px-2.5 py-2 text-sm" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setFormOpen(false)} className="h-9 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-accent">Cancel</button>
                <button onClick={submit} className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover">Submit</button>
              </div>
            </div>
          </SectionCard>
        )}
        <div className="mt-4 space-y-2.5">
          {visible.length === 0 && <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground">No {tab} requests yet.</p>}
          {visible.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{r.title}</p>
                {r.detail && <p className="truncate text-xs text-muted-foreground">{r.detail}</p>}
              </div>
              <StatusPill status={r.status} />
              {r.status === "pending" && (
                <button onClick={() => persist(items.filter((i) => i.id !== r.id))} aria-label={`Delete ${r.title}`} className="rounded-lg p-1.5 hover:bg-accent">
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
