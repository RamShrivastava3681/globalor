import { useState } from "react";
import { api, getToken } from "@/lib/api-client";
import { Paperclip, Loader2, X, FileText, Download } from "lucide-react";
import { toast } from "sonner";

export type DocMeta = {
  path: string;
  name: string;
  type: string;
  size: number;
  uploaded_at: string;
};

type Props = {
  userId: string;
  scope: string; // e.g. "expenses", "invoices", "purchase_invoices"
  docs: DocMeta[];
  onChange: (next: DocMeta[]) => void;
  label?: string;
  hint?: string;
};

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export function DocumentUploader({ userId, scope, docs, onChange, label = "Supporting documents", hint }: Props) {
  const [busy, setBusy] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const next: DocMeta[] = [...docs];
      for (const f of Array.from(files)) {
        if (f.size > 15 * 1024 * 1024) { toast.error(`${f.name}: max 15 MB`); continue; }

        const formData = new FormData();
        formData.append("files", f);
        formData.append("scope", scope);

        const results = await api.post<DocMeta[]>("/api/upload", formData);
        next.push(...results);
      }
      onChange(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: DocMeta) => {
    try {
      await api.delete("/api/upload", { paths: [d.path] });
    } catch { /* ignore */ }
    onChange(docs.filter((x) => x.path !== d.path));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:border-primary hover:text-primary">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          Attach
          <input type="file" multiple className="hidden" disabled={busy}
            onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      {docs.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No documents attached.
        </div>
      ) : (
        <ul className="space-y-1">
          {docs.map((d) => (
            <li key={d.path} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate" title={d.name}>{d.name}</span>
                <span className="shrink-0 text-muted-foreground">{(d.size / 1024).toFixed(0)} KB</span>
              </div>
              <button type="button" onClick={() => remove(d)} className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive" aria-label="Remove">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DocumentList({ docs }: { docs: DocMeta[] }) {
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const open = async (d: DocMeta) => {
    setBusyPath(d.path);
    try {
      const { signedUrl } = await api.get<{ signedUrl: string }>(`/api/upload/signed-url/${encodeURIComponent(d.path)}`);
      window.open(signedUrl, "_blank", "noopener");
    } catch (err) {
      toast.error("Could not open document");
    } finally {
      setBusyPath(null);
    }
  };

  if (!docs || docs.length === 0) {
    return <div className="text-xs text-muted-foreground">No documents attached.</div>;
  }
  return (
    <ul className="space-y-1">
      {docs.map((d) => (
        <li key={d.path} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate" title={d.name}>{d.name}</span>
            <span className="shrink-0 text-muted-foreground">{(d.size / 1024).toFixed(0)} KB</span>
          </div>
          <button type="button" onClick={() => open(d)} disabled={busyPath === d.path}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] hover:border-primary hover:text-primary disabled:opacity-60">
            {busyPath === d.path ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Open
          </button>
        </li>
      ))}
    </ul>
  );
}
