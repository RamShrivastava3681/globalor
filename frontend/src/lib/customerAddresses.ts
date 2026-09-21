/** Shared helpers for the customer address model: separate billing & shipping lists (no registered address). */

export type AddressKind = "billing" | "shipping";

export type CustomerAddressEntry = {
  id?: string;
  label: string;
  kind: AddressKind;
  line1: string;
  line2: string;
  city: string;
  state: string;
  country: string;
  postal_code: string;
  is_default: boolean;
};

export const emptyCustomerAddress = (kind: AddressKind = "billing"): CustomerAddressEntry => ({
  label: "",
  kind,
  line1: "",
  line2: "",
  city: "",
  state: "",
  country: "",
  postal_code: "",
  is_default: false,
});

export function formatAddressParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export function formatEntryAddress(a: CustomerAddressEntry): string {
  return formatAddressParts([a.line1, a.line2, a.city, a.state, a.country, a.postal_code]);
}

/** One selectable address option for a customer. */
export type AddressOption = { key: string; label: string; full: string };

/** Minimal shape of a customer needed for address picking. */
export type AddressCustomer = {
  addresses?: Array<{
    id?: string;
    label?: string | null;
    /** Legacy records may still carry "both" — treated as usable for either side. */
    kind?: AddressKind | "both";
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postal_code?: string | null;
    is_default?: boolean;
  }> | null;
};

function matchesKind(kind: string | null | undefined, want: AddressKind): boolean {
  return kind === want || kind === "both" || !kind;
}

export function addressOptionsFor(
  customer: AddressCustomer | null | undefined,
  kind: AddressKind,
): AddressOption[] {
  if (!customer) return [];
  const out: AddressOption[] = [];
  for (const a of customer.addresses ?? []) {
    if (!matchesKind(a.kind, kind)) continue;
    const full = formatAddressParts([a.line1, a.line2, a.city, a.state, a.country, a.postal_code]);
    if (!full) continue;
    out.push({
      key: a.id ?? full,
      label: `${a.label || "Saved address"} (${kind})${a.is_default ? " · default" : ""}`,
      full,
    });
  }
  return out;
}

/** Default address string for a customer + kind (default-flagged first). */
export function defaultAddressFor(
  customer: AddressCustomer | null | undefined,
  kind: AddressKind,
): string {
  const opts = addressOptionsFor(customer, kind);
  if (opts.length === 0 || !customer) return "";
  const saved = (customer.addresses ?? []).filter(
    (a) => matchesKind(a.kind, kind) && a.is_default,
  );
  if (saved.length > 0) {
    const first = saved[0];
    return formatAddressParts([
      first.line1,
      first.line2,
      first.city,
      first.state,
      first.country,
      first.postal_code,
    ]);
  }
  return opts[0].full;
}

/** Split a customer's saved addresses into separate billing / shipping lists. */
export function splitAddressesByKind(
  customer: AddressCustomer | null | undefined,
): { billing: NonNullable<AddressCustomer["addresses"]>; shipping: NonNullable<AddressCustomer["addresses"]> } {
  const billing: NonNullable<AddressCustomer["addresses"]> = [];
  const shipping: NonNullable<AddressCustomer["addresses"]> = [];
  for (const a of customer?.addresses ?? []) {
    if (a.kind === "shipping") shipping.push(a);
    else if (a.kind === "billing") billing.push(a);
    else {
      // Legacy "both" entries appear under both lists.
      billing.push(a);
      shipping.push(a);
    }
  }
  return { billing, shipping };
}
