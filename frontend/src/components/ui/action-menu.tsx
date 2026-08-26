import { useState, useRef, useEffect, ReactNode } from "react";
import { MoreHorizontal, ChevronDown } from "lucide-react";

export interface ActionMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: "default" | "warning" | "destructive";
  disabled?: boolean;
}

/**
 * Compact action menu that collapses secondary actions into a dropdown.
 * Primary action stays visible; everything else goes under "⋯ More".
 */
export function ActionMenu({
  primaryAction,
  items,
  className = "",
}: {
  primaryAction?: { label: string; icon?: ReactNode; onClick: () => void };
  items: ActionMenuItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {primaryAction && (
        <button
          onClick={primaryAction.onClick}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary-hover transition-colors"
        >
          {primaryAction.icon}
          {primaryAction.label}
        </button>
      )}

      {items.length > 0 && (
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground shadow-sm hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">More</span>
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>

          {open && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-border bg-card shadow-xl animate-fade-in">
              <div className="p-1">
                {items.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => { item.onClick(); setOpen(false); }}
                    disabled={item.disabled}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-40
                      ${item.variant === "destructive"
                        ? "text-destructive hover:bg-destructive/10"
                        : item.variant === "warning"
                        ? "text-warning hover:bg-warning/10"
                        : "text-foreground hover:bg-muted/70"
                      }`}
                  >
                    {item.icon && <span className="shrink-0">{item.icon}</span>}
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
