import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/ledger-ui";
import { SectionCard, FooterBanner } from "@/components/workbench";
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/template")({
  component: TemplatePage,
});

const SWATCHES = ["#0067c2", "#0f766e", "#7c3aed", "#b45309", "#0e1b2c"];
const KEY = "whizunik-invoice-accent";

function TemplatePage() {
  const [accent, setAccent] = useState(() => {
    try {
      return localStorage.getItem(KEY) ?? SWATCHES[0];
    } catch {
      return SWATCHES[0];
    }
  });
  return (
    <div>
      <PageHeader eyebrow="System" title={<span className="inline-flex items-center gap-2"><Palette className="h-5 w-5 text-primary" /> Invoice template</span>} description="Brand accents for generated invoice PDFs." />
      <SectionCard title="Accent colour" className="mt-4">
        <div className="flex gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => { setAccent(c); try { localStorage.setItem(KEY, c); } catch { /* ignore */ } }}
              aria-label={`Use ${c}`}
              aria-pressed={accent === c}
              style={{ background: c }}
              className={cn("h-10 w-10 rounded-full border-2", accent === c ? "border-foreground" : "border-transparent")}
            />
          ))}
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <div className="px-4 py-3 text-sm font-bold text-white" style={{ background: accent }}>INVOICE · WHIZUNIK</div>
          <div className="bg-card px-4 py-3 text-[13px] text-muted-foreground">Bill-to · lines · totals preview with the selected accent.</div>
        </div>
      </SectionCard>
      <FooterBanner>Template settings are UI-only in this release and preview locally.</FooterBanner>
    </div>
  );
}
