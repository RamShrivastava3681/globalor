import { scanTable, getItem, TABLES } from "../db/client.js";
import type { Customer } from "../types/index.js";

type CompanyFilter = {
  filterExpression?: string;
  expressionAttributeValues?: Record<string, unknown>;
  expressionAttributeNames?: Record<string, string>;
};

/**
 * The live customer master lives in the DEBTORS table (`*_debtors`).
 * The newer CUSTOMERS table (`*_customers`) is currently empty but kept for
 * forward compatibility. Every read merges both tables (debtors first,
 * customers fill gaps) so the customer book is never empty when debtors exist.
 */
export async function scanCustomersMerged(filter?: CompanyFilter): Promise<Customer[]> {
  const [debtors, customers] = await Promise.all([
    scanTable<Customer>(TABLES.DEBTORS, filter as any).catch(() => [] as Customer[]),
    scanTable<Customer>(TABLES.CUSTOMERS, filter as any).catch(() => [] as Customer[]),
  ]);
  const byId = new Map<string, Customer>();
  for (const d of [...debtors, ...customers]) {
    if (!d || !(d as any).id) continue;
    if (!byId.has((d as any).id)) byId.set((d as any).id, d);
  }
  return [...byId.values()];
}

export function buildCustomerMap(customers: Customer[]): Map<string, Customer> {
  return new Map(customers.map((d) => [d.id, d]));
}

/** Look up a single customer by id, checking debtors first then customers. */
export async function getCustomerById(id: string | null | undefined): Promise<Customer | undefined> {
  if (!id) return undefined;
  const fromDebtors = (await getItem(TABLES.DEBTORS, { id }).catch(() => undefined)) as Customer | undefined;
  if (fromDebtors) return fromDebtors;
  return (await getItem(TABLES.CUSTOMERS, { id }).catch(() => undefined)) as Customer | undefined;
}

/**
 * Invoices in the live DB link via `debtor_id` (legacy), while newer code
 * writes `customer_id`. Resolve either so enrichment never drops the link.
 */
export function getInvoicePartyId(inv: any): string | null {
  return (inv?.customer_id ?? inv?.debtor_id ?? null) as string | null;
}

/** Return a copy of the invoice with `customer_id` + `debtor_id` both populated. */
export function normalizeInvoiceParty<T extends Record<string, any>>(inv: T): T & { customer_id: any; debtor_id: any } {
  const partyId = getInvoicePartyId(inv);
  return { ...inv, customer_id: partyId ?? (inv as any).customer_id ?? null, debtor_id: partyId ?? (inv as any).debtor_id ?? null };
}
