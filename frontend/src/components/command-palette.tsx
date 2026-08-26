import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { CornerDownLeft, History } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type CommandPaletteItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  to?: string;
  keywords?: string;
  group: string;
};

const RECENTS_KEY = "command-palette-recents";
const MAX_RECENTS = 6;

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function persistRecents(recents: string[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
  } catch {
    // ignore storage errors
  }
}

/** Open the command palette from anywhere (header, sidebar, shortcuts). */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("global:open-command-palette"));
}

export function CommandPalette({ items }: { items: CommandPaletteItem[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>(() => readRecents());

  // Global keyboard shortcut (⌘K / Ctrl+K) + external open events.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("global:open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("global:open-command-palette", onOpen);
    };
  }, []);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const run = (item: CommandPaletteItem) => {
    setOpen(false);
    if (item.to) {
      navigate({ to: item.to });
      // Record the recents, newest first.
      const next = [item.label, ...recents.filter((r) => r !== item.label)].slice(0, MAX_RECENTS);
      setRecents(next);
      persistRecents(next);
    }
  };

  const recentItems = useMemo(
    () => recents.map((label) => itemById.get(label)).filter((x): x is CommandPaletteItem => !!x),
    [recents, itemById],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, CommandPaletteItem[]>();
    for (const item of items) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command className="rounded-xl">
        <CommandInput placeholder="Search pages and actions…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {recentItems.length > 0 && (
            <CommandGroup heading="Recent">
              {recentItems.map((item) => (
                <CommandItem key={`recent-${item.id}`} value={`recent ${item.label} ${item.keywords ?? ""}`} onSelect={() => run(item)}>
                  <History className="text-muted-foreground" />
                  <span>{item.label}</span>
                  <CornerDownLeft className="ml-auto h-3.5 w-3.5 text-muted-foreground/50" />
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {grouped.map(([group, groupItems]) => (
            <CommandGroup key={group} heading={group}>
              {groupItems.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem key={item.id} value={`${item.label} ${item.keywords ?? ""}`} onSelect={() => run(item)}>
                    <Icon className="text-muted-foreground" />
                    <span>{item.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
