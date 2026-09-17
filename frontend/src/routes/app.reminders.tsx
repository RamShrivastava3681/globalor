import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/ledger-ui";
import { SectionCard } from "@/components/workbench";
import { Mail, Plus, Trash2, Check } from "lucide-react";

export const Route = createFileRoute("/app/reminders")({
  component: RemindersPage,
});

type R = { id: string; title: string; date: string; done: boolean };
const KEY = "whizunik-reminders";

function load(): R[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function RemindersPage() {
  const [items, setItems] = useState<R[]>(load);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const persist = (n: R[]) => {
    setItems(n);
    try {
      localStorage.setItem(KEY, JSON.stringify(n));
    } catch {
      // ignore
    }
  };
  return (
    <div>
      <PageHeader eyebrow="System" title={<span className="inline-flex items-center gap-2"><Mail className="h-5 w-5 text-primary" /> Reminders</span>} description="Follow-ups and scheduled nudges." />
      <SectionCard title="Add reminder" className="mt-4">
        <div className="flex flex-wrap gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reminder title" aria-label="Reminder title" className="h-9 min-w-52 flex-1 rounded-md border border-border px-2.5 text-sm" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Reminder date" className="h-9 rounded-md border border-border px-2.5 text-sm" />
          <button
            onClick={() => { if (!title.trim()) return; persist([{ id: crypto.randomUUID(), title: title.trim(), date, done: false }, ...items]); setTitle(""); setDate(""); }}
            className="inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white hover:bg-primary-hover"
          ><Plus className="h-4 w-4" /> Add</button>
        </div>
      </SectionCard>
      <div className="mt-4 space-y-2">
        {items.length === 0 && <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground">No reminders.</p>}
        {items.map((r) => (
          <div key={r.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <button onClick={() => persist(items.map((i) => (i.id === r.id ? { ...i, done: !i.done } : i)))} aria-label={r.done ? `Reopen ${r.title}` : `Complete ${r.title}`} className="rounded-full border border-border p-1.5 hover:bg-accent">
              {r.done ? <Check className="h-3.5 w-3.5 text-success" /> : <span className="block h-3.5 w-3.5" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-semibold ${r.done ? "line-through opacity-60" : ""}`}>{r.title}</p>
              {r.date && <p className="text-xs text-muted-foreground">{r.date}</p>}
            </div>
            <button onClick={() => persist(items.filter((i) => i.id !== r.id))} aria-label={`Delete ${r.title}`} className="rounded-lg p-1.5 hover:bg-accent"><Trash2 className="h-4 w-4 text-muted-foreground" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
