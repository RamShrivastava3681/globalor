import { ReactNode, useState, useRef, useEffect } from "react";
import { X, Search, SlidersHorizontal, ChevronDown, Calendar, ArrowUpDown, ArrowUp, ArrowDown, Check } from "lucide-react";

export interface FilterOption {
  label: string;
  value: string;
}

export interface SortOption {
  field: string;
  label: string;
}

export interface DateRangeFilter {
  label: string;
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onClear: () => void;
}

/* ── Quick-date presets ── */
const DATE_PRESETS: { label: string; getRange: () => { from: string; to: string } }[] = [
  { label: "Today", getRange: () => { const d = new Date(); const s = fmt(d); return { from: s, to: s }; } },
  { label: "Yesterday", getRange: () => { const d = new Date(); d.setDate(d.getDate() - 1); const s = fmt(d); return { from: s, to: s }; } },
  { label: "Last 7 days", getRange: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 7); return { from: fmt(from), to: fmt(to) }; } },
  { label: "Last 30 days", getRange: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 30); return { from: fmt(from), to: fmt(to) }; } },
  { label: "This month", getRange: () => { const now = new Date(); const from = new Date(now.getFullYear(), now.getMonth(), 1); return { from: fmt(from), to: fmt(now) }; } },
  { label: "Last month", getRange: () => { const now = new Date(); const from = new Date(now.getFullYear(), now.getMonth() - 1, 1); const to = new Date(now.getFullYear(), now.getMonth(), 0); return { from: fmt(from), to: fmt(to) }; } },
  { label: "This quarter", getRange: () => { const now = new Date(); const q = Math.floor(now.getMonth() / 3); const from = new Date(now.getFullYear(), q * 3, 1); return { from: fmt(from), to: fmt(now) }; } },
  { label: "This year", getRange: () => { const now = new Date(); const from = new Date(now.getFullYear(), 0, 1); return { from: fmt(from), to: fmt(now) }; } },
];

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

/* ── Popover hook ── */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return { open, setOpen, ref };
}

/* ── Arrange By Dropdown ── */
function ArrangeByDropdown({
  sortOptions,
  sortField,
  sortOrder,
  onSortChange,
  onOrderChange,
}: {
  sortOptions: SortOption[];
  sortField: string;
  sortOrder: "asc" | "desc";
  onSortChange: (field: string) => void;
  onOrderChange: (order: "asc" | "desc") => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const active = sortOptions.find((o) => o.field === sortField);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 h-8 rounded-lg border border-border bg-background px-2.5 text-[13px] text-foreground hover:border-primary/40 hover:bg-muted/30 transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
      >
        {sortOrder === "asc" ? (
          <ArrowUp className="h-3 w-3 text-primary" />
        ) : (
          <ArrowDown className="h-3 w-3 text-primary" />
        )}
        <span className="font-medium">{active?.label ?? "Sort"}</span>
        <ChevronDown className={`h-3 w-3 text-muted-foreground/60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-xl animate-popover-in">
          {/* Direction toggle */}
          <div className="flex border-b border-border/60">
            <button
              onClick={() => { onOrderChange("asc"); setOpen(false); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium transition ${
                sortOrder === "asc" ? "bg-primary/8 text-primary" : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <ArrowUp className="h-3 w-3" /> Ascending
            </button>
            <button
              onClick={() => { onOrderChange("desc"); setOpen(false); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium transition border-l border-border/60 ${
                sortOrder === "desc" ? "bg-primary/8 text-primary" : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <ArrowDown className="h-3 w-3" /> Descending
            </button>
          </div>

          {/* Field options */}
          <div className="py-1">
            {sortOptions.map((opt) => (
              <button
                key={opt.field}
                onClick={() => { onSortChange(opt.field); setOpen(false); }}
                className={`flex items-center w-full gap-2 px-3 py-2 text-[13px] transition ${
                  sortField === opt.field
                    ? "bg-primary/8 text-primary font-medium"
                    : "text-foreground hover:bg-muted/40"
                }`}
              >
                <span className="flex-1 text-left">{opt.label}</span>
                {sortField === opt.field && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Date Range Picker with Presets ── */
function DateRangePicker({ dr }: { dr: DateRangeFilter }) {
  const { open, setOpen, ref } = usePopover();
  const hasFilter = dr.from || dr.to;
  const [mode, setMode] = useState<"presets" | "custom">("presets");

  const applyPreset = (range: { from: string; to: string }) => {
    dr.onFromChange(range.from);
    dr.onToChange(range.to);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 h-8 rounded-lg border px-2.5 text-[13px] transition-all ${
          hasFilter
            ? "border-primary/30 bg-primary/5 text-primary"
            : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted/30"
        } focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20`}
      >
        <Calendar className="h-3 w-3" />
        <span className="font-medium">{dr.label}</span>
        {hasFilter && (
          <span className="text-[11px] text-primary/80 ml-0.5">
            {dr.from}{dr.to && dr.from !== dr.to ? ` – ${dr.to}` : ""}
          </span>
        )}
        <ChevronDown className={`h-3 w-3 text-muted-foreground/60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-xl animate-popover-in">
          {/* Mode tabs */}
          <div className="flex border-b border-border/60">
            <button
              onClick={() => setMode("presets")}
              className={`flex-1 py-2 text-[12px] font-medium transition ${
                mode === "presets" ? "bg-primary/8 text-primary border-b-2 border-primary" : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              Quick select
            </button>
            <button
              onClick={() => setMode("custom")}
              className={`flex-1 py-2 text-[12px] font-medium transition border-l border-border/60 ${
                mode === "custom" ? "bg-primary/8 text-primary border-b-2 border-primary" : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              Custom range
            </button>
          </div>

          {mode === "presets" ? (
            <div className="py-1">
              {DATE_PRESETS.map((preset) => {
                const range = preset.getRange();
                const isActive = dr.from === range.from && dr.to === range.to;
                return (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(range)}
                    className={`flex items-center w-full gap-2 px-3 py-2 text-[13px] transition ${
                      isActive
                        ? "bg-primary/8 text-primary font-medium"
                        : "text-foreground hover:bg-muted/40"
                    }`}
                  >
                    <span className="flex-1 text-left">{preset.label}</span>
                    {isActive && <Check className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-3 space-y-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">From</label>
                <input
                  type="date"
                  value={dr.from}
                  onChange={(e) => dr.onFromChange(e.target.value)}
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-[13px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">To</label>
                <input
                  type="date"
                  value={dr.to}
                  onChange={(e) => dr.onToChange(e.target.value)}
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-[13px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                {(dr.from || dr.to) && (
                  <button
                    onClick={() => { dr.onClear(); setOpen(false); }}
                    className="text-[12px] text-muted-foreground hover:text-foreground underline"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="ml-auto rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 transition"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FILTER BAR — Main export
   ═══════════════════════════════════════════════════════════════ */
export function FilterBar({
  searchPlaceholder,
  searchValue,
  onSearchChange,
  statusOptions,
  statusValue,
  onStatusChange,
  dateRanges = [],
  sortOptions,
  sortField,
  sortOrder,
  onSortChange,
  onSortOrderChange,
  children,
  className = "",
}: {
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (v: string) => void;
  statusOptions: FilterOption[];
  statusValue: string;
  onStatusChange: (v: string) => void;
  dateRanges?: DateRangeFilter[];
  sortOptions?: SortOption[];
  sortField?: string;
  sortOrder?: "asc" | "desc";
  onSortChange?: (field: string) => void;
  onSortOrderChange?: (order: "asc" | "desc") => void;
  children?: ReactNode;
  className?: string;
}) {
  const hasActiveFilters =
    statusValue !== statusOptions[0]?.value ||
    searchValue ||
    dateRanges.some((d) => d.from || d.to);

  const clearAll = () => {
    onStatusChange(statusOptions[0]?.value ?? "");
    onSearchChange("");
    dateRanges.forEach((d) => d.onClear());
  };

  return (
    <div className={`rounded-xl border border-border bg-card ${className}`}>
      {/* Main row */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3">
        {/* Search */}
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder ?? "Search…"}
            className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
          />
          {searchValue && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="hidden h-5 w-px bg-border/70 sm:block" />

        {/* Status dropdown */}
        <div className="relative">
          <select
            value={statusValue}
            onChange={(e) => onStatusChange(e.target.value)}
            className="h-8 appearance-none rounded-lg border border-border bg-background pl-2.5 pr-7 text-[13px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 cursor-pointer"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
        </div>

        {/* Divider */}
        <div className="hidden h-5 w-px bg-border/70 sm:block" />

        {/* Date range pickers with presets */}
        {dateRanges.map((dr) => (
          <DateRangePicker key={dr.label} dr={dr} />
        ))}

        {/* Divider */}
        {sortOptions && sortField && <div className="hidden h-5 w-px bg-border/70 sm:block" />}

        {/* Arrange By dropdown */}
        {sortOptions && sortField && onSortChange && onSortOrderChange && (
          <ArrangeByDropdown
            sortOptions={sortOptions}
            sortField={sortField}
            sortOrder={sortOrder ?? "asc"}
            onSortChange={onSortChange}
            onOrderChange={onSortOrderChange}
          />
        )}

        {/* Extra children (for bulk actions, etc.) */}
        {children}
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-3 py-2">
          <SlidersHorizontal className="h-3 w-3 text-muted-foreground/40" />
          {statusValue !== statusOptions[0]?.value && (
            <FilterChip
              label={`Status: ${statusOptions.find((o) => o.value === statusValue)?.label}`}
              onClear={() => onStatusChange(statusOptions[0]?.value ?? "")}
            />
          )}
          {dateRanges.map((dr) =>
            dr.from || dr.to ? (
              <FilterChip
                key={dr.label}
                label={`${dr.label}: ${dr.from || "…"} → ${dr.to || "…"}`}
                onClear={dr.onClear}
              />
            ) : null
          )}
          {searchValue && (
            <FilterChip
              label={`Search: "${searchValue}"`}
              onClear={() => onSearchChange("")}
            />
          )}
          <button
            onClick={clearAll}
            className="ml-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground underline"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary">
      {label}
      <button onClick={onClear} className="rounded-full p-0.5 hover:bg-primary/10">
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}
