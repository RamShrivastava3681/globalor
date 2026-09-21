/** Shared helpers for the customer multi-address (billing / shipping) model. */

export type CustomerAddressEntry = {
  id?: string;
  label: string;
  kind: "billing" | "shipping" | "both";
  line1: string;
  line2: string;
  city: string;
  state: string;
  country: string;
  postal_code: string;
  is_default: boolean;
};

export const emptyCustomerAddress = (): CustomerAddressEntry => ({
  label: "",
  kind: "both",
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

/** One selectable address option for a customer (registered + saved). */
export type AddressOption = { key: string; label: string; full: string };

/** Minimal shape of a customer needed for address picking. */
export type AddressCustomer = {
  registered_address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postal_code?: string | null;
  addresses?: Array<{
    id?: string;
    label?: string | null;
    kind?: "billing" | "shipping" | "both";
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postal_code?: string | null;
    is_default?: boolean;
  }> | null;
};

export function addressOptionsFor(
  customer: AddressCustomer | null | undefined,
  kind: "billing" | "shipping",
): AddressOption[] {
  if (!customer) return [];
  const out: AddressOption[] = [];
  const registered = formatAddressParts([
    customer.registered_address,
    customer.city,
    customer.state,
    customer.country,
    customer.postal_code,
  ]);
  if (registered) {
    out.push({ key: "__registered__", label: "Registered address", full: registered });
  }
  for (const a of customer.addresses ?? []) {
    if (a.kind !== "both" && a.kind !== kind) continue;
    const full = formatAddressParts([a.line1, a.line2, a.city, a.state, a.country, a.postal_code]);
    if (!full) continue;
    out.push({
      key: a.id ?? full,
      label: `${a.label || "Saved address"} (${a.kind})${a.is_default ? " · default" : ""}`,
      full,
    });
  }
  return out;
}

/** Default address string for a customer + kind (default-flagged first). */
export function defaultAddressFor(
  customer: AddressCustomer | null | undefined,
  kind: "billing" | "shipping",
): string {
  const opts = addressOptionsFor(customer, kind);
  if (opts.length === 0 || !customer) return "";
  const saved = (customer.addresses ?? []).filter(
    (a) => (a.kind === "both" || a.kind === kind) && a.is_default,
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
