/** Shared helpers for the customer billing / shipping address model (no registered address). */

type AddressLike = {
  kind?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postal_code?: string | null;
  is_default?: boolean | null;
};

type CustomerLike = {
  addresses?: AddressLike[] | null;
};

function formatParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

function matchesKind(a: AddressLike, kind: "billing" | "shipping"): boolean {
  // Legacy records may still carry kind "both" — treat them as usable for either side.
  return a.kind === kind || a.kind === "both" || !a.kind;
}

/** Default address string for a customer + kind (default-flagged entry first). */
export function defaultCustomerAddressFor(
  customer: CustomerLike | null | undefined,
  kind: "billing" | "shipping",
): string | null {
  const list = (customer?.addresses ?? []).filter((a) => matchesKind(a, kind));
  if (list.length === 0) return null;
  const flagged = list.find((a) => a.is_default);
  const picked = flagged ?? list[0];
  const full = formatParts([
    picked.line1,
    picked.line2,
    picked.city,
    picked.state,
    picked.country,
    picked.postal_code,
  ]);
  return full || null;
}
