import type { LogisticsAdapter } from "./types.js";
import { manualAdapter } from "./manual.js";
import { stubDomesticAdapter } from "./stubDomestic.js";

const registry = new Map<string, LogisticsAdapter>([
  [manualAdapter.key, manualAdapter],
  [stubDomesticAdapter.key, stubDomesticAdapter],
]);

export function getAdapter(key: string | null | undefined): LogisticsAdapter {
  if (key && registry.has(key)) return registry.get(key)!;
  return manualAdapter;
}

export function listAdapters(): LogisticsAdapter[] {
  return Array.from(registry.values());
}

export function registerAdapter(adapter: LogisticsAdapter): void {
  registry.set(adapter.key, adapter);
}
