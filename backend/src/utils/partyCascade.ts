import { scanTable, batchDeleteItems, TABLES } from "../db/client.js";

/** Helper to delete keys in batches of 25 */
async function deleteKeys(table: string, ids: string[]) {
  if (ids.length === 0) return 0;
  await batchDeleteItems(table, ids.map((id) => ({ id })));
  return ids.length;
}

/**
 * Cascade delete everything linked to a customer (debtor).
 * Company-scoped when companyId is provided.
 */
export async function cascadeDeleteCustomer(companyId: string | null, customerId: string) {
  const filterCompany = (item: any) => !companyId || item.company_id === companyId || !item.company_id;

  let totalDeleted = 0;

  // 1. Sales invoices (INVOICES) — customer_id / debtor_id
  const invoices = await scanTable<any>(TABLES.INVOICES);
  const invoiceIds = invoices
    .filter((inv) => (inv.customer_id === customerId || inv.debtor_id === customerId) && filterCompany(inv))
    .map((inv) => inv.id);
  // Also invoices linked via goods_sales_order_id that belong to this customer (covered via GSO below, but invoice may have SO link without direct customer_id mismatch - still ensure deletion via SO)
  totalDeleted += await deleteKeys(TABLES.INVOICES, invoiceIds);

  // 2. Goods sales orders — customer_id / billing_customer_id / shipping_customer_id
  const gsos = await scanTable<any>(TABLES.GOODS_SALES_ORDERS);
  const gsoIds = gsos
    .filter(
      (o) =>
        (o.customer_id === customerId || o.billing_customer_id === customerId || o.shipping_customer_id === customerId) &&
        filterCompany(o),
    )
    .map((o) => o.id);
  totalDeleted += await deleteKeys(TABLES.GOODS_SALES_ORDERS, gsoIds);

  // 3. Goods dispatches linked to those sales orders
  if (gsoIds.length > 0) {
    const gsoIdSet = new Set(gsoIds);
    const dispatches = await scanTable<any>(TABLES.GOODS_DISPATCHES);
    const dispIds = dispatches.filter((d) => gsoIdSet.has(d.goods_sales_order_id) && filterCompany(d)).map((d) => d.id);
    // Also invoices that are linked to those SOs but not caught by direct customer_id (e.g. amount based)
    const invoicesBySo = invoices.filter((inv) => inv.goods_sales_order_id && gsoIdSet.has(inv.goods_sales_order_id) && filterCompany(inv)).map((inv) => inv.id);
    const extraInvoiceIds = invoicesBySo.filter((id) => !invoiceIds.includes(id));
    if (extraInvoiceIds.length > 0) totalDeleted += await deleteKeys(TABLES.INVOICES, extraInvoiceIds);
    totalDeleted += await deleteKeys(TABLES.GOODS_DISPATCHES, dispIds);

    // Stock movements tied to those dispatches (optional cleanup)
    if (dispIds.length > 0) {
      const movements = await scanTable<any>(TABLES.STOCK_MOVEMENTS);
      const dispSet = new Set(dispIds);
      const moveIds = movements.filter((m) => m.goods_dispatch_id && dispSet.has(m.goods_dispatch_id) && filterCompany(m)).map((m) => m.id);
      totalDeleted += await deleteKeys(TABLES.STOCK_MOVEMENTS, moveIds);
    }
  }

  // 4. Goods purchase orders where customer is bill-to / ship-to
  const gpos = await scanTable<any>(TABLES.GOODS_PURCHASE_ORDERS);
  const gpoBillShipIds = gpos
    .filter((po) => (po.bill_to_customer_id === customerId || po.ship_to_customer_id === customerId) && filterCompany(po))
    .map((po) => po.id);
  // Note: we don't delete GPOs here if they are supplier-driven; just the customer linkage would orphan.
  // Requirement says delete all data created on that party — so if GPO bills/ships to this customer, delete it and its receipts.
  if (gpoBillShipIds.length > 0) {
    totalDeleted += await deleteKeys(TABLES.GOODS_PURCHASE_ORDERS, gpoBillShipIds);
    const receipts = await scanTable<any>(TABLES.GOODS_RECEIPTS);
    const receiptIds = receipts.filter((r) => gpoBillShipIds.includes(r.goods_purchase_order_id) && filterCompany(r)).map((r) => r.id);
    totalDeleted += await deleteKeys(TABLES.GOODS_RECEIPTS, receiptIds);
  }

  // 5. Quotations
  const quotes = await scanTable<any>(TABLES.QUOTATIONS);
  const quoteIds = quotes.filter((q) => q.customer_id === customerId && filterCompany(q)).map((q) => q.id);
  totalDeleted += await deleteKeys(TABLES.QUOTATIONS, quoteIds);

  // 6. Purchase orders (sales side) — customer_id
  const pos = await scanTable<any>(TABLES.PURCHASE_ORDERS);
  const poIds = pos.filter((po) => po.customer_id === customerId && filterCompany(po)).map((po) => po.id);
  totalDeleted += await deleteKeys(TABLES.PURCHASE_ORDERS, poIds);

  // 7. Payments — customer_id
  const payments = await scanTable<any>(TABLES.PAYMENTS);
  const paymentIds = payments.filter((p) => p.customer_id === customerId && filterCompany(p)).map((p) => p.id);
  totalDeleted += await deleteKeys(TABLES.PAYMENTS, paymentIds);

  // 8. Advances linked to those sales purchase orders (proformas) — if any PO was deleted
  if (poIds.length > 0) {
    const advances = await scanTable<any>(TABLES.ADVANCES);
    const advIds = advances.filter((a) => a.purchase_order_id && poIds.includes(a.purchase_order_id) && filterCompany(a)).map((a) => a.id);
    totalDeleted += await deleteKeys(TABLES.ADVANCES, advIds);
  }

  // 9. Stock movements directly tied to deleted invoices
  if (invoiceIds.length > 0) {
    const movements = await scanTable<any>(TABLES.STOCK_MOVEMENTS);
    const invSet = new Set(invoiceIds);
    const moveIds = movements.filter((m) => m.invoice_id && invSet.has(m.invoice_id) && filterCompany(m)).map((m) => m.id);
    if (moveIds.length > 0) totalDeleted += await deleteKeys(TABLES.STOCK_MOVEMENTS, moveIds);
  }

  // 10. Alerts / workflow tasks scoped to customer (best-effort cleanup — no id key, filter by customer_id)
  // Alerts/workflow tasks use different key schemas (id only), but we can delete those referencing the customer.
  const alerts = await scanTable<any>(TABLES.ALERTS);
  const alertIds = alerts.filter((a) => a.customer_id === customerId && filterCompany(a)).map((a) => a.id);
  if (alertIds.length > 0) totalDeleted += await deleteKeys(TABLES.ALERTS, alertIds);

  return totalDeleted;
}

/**
 * Cascade delete everything linked to a supplier/vendor.
 * `supplierId` may live in VENDORS or SUPPLIERS table; related docs store it as
 * vendor_id, supplier_id, or goods_purchase_order supplier_id.
 */
export async function cascadeDeleteSupplier(companyId: string | null, supplierId: string) {
  const filterCompany = (item: any) => !companyId || item.company_id === companyId || !item.company_id;
  let totalDeleted = 0;

  // 1. Purchase invoices — vendor_id
  const pis = await scanTable<any>(TABLES.PURCHASE_INVOICES);
  const piIds = pis.filter((pi) => pi.vendor_id === supplierId && filterCompany(pi)).map((pi) => pi.id);
  totalDeleted += await deleteKeys(TABLES.PURCHASE_INVOICES, piIds);

  // 2. Goods purchase orders — supplier_id
  const gpos = await scanTable<any>(TABLES.GOODS_PURCHASE_ORDERS);
  const gpoIds = gpos.filter((po) => po.supplier_id === supplierId && filterCompany(po)).map((po) => po.id);
  totalDeleted += await deleteKeys(TABLES.GOODS_PURCHASE_ORDERS, gpoIds);

  // 3. Goods receipts linked to those GPOs
  if (gpoIds.length > 0) {
    const receipts = await scanTable<any>(TABLES.GOODS_RECEIPTS);
    const receiptIds = receipts.filter((r) => gpoIds.includes(r.goods_purchase_order_id) && filterCompany(r)).map((r) => r.id);
    totalDeleted += await deleteKeys(TABLES.GOODS_RECEIPTS, receiptIds);
    // Purchase invoices linked via goods_purchase_order_id not caught by vendor_id
    const piByGpo = pis.filter((pi) => pi.goods_purchase_order_id && gpoIds.includes(pi.goods_purchase_order_id) && filterCompany(pi) && !piIds.includes(pi.id)).map((pi) => pi.id);
    if (piByGpo.length > 0) totalDeleted += await deleteKeys(TABLES.PURCHASE_INVOICES, piByGpo);
  }

  // 4. Sales invoices that reference supplier_id
  const sis = await scanTable<any>(TABLES.INVOICES);
  const siIds = sis.filter((si) => si.supplier_id === supplierId && filterCompany(si)).map((si) => si.id);
  if (siIds.length > 0) totalDeleted += await deleteKeys(TABLES.INVOICES, siIds);

  // 5. Purchase orders (purchase side) — vendor_id
  const pos = await scanTable<any>(TABLES.PURCHASE_ORDERS);
  const poIds = pos.filter((po) => po.vendor_id === supplierId && filterCompany(po)).map((po) => po.id);
  totalDeleted += await deleteKeys(TABLES.PURCHASE_ORDERS, poIds);

  // 6. Credit / debit notes — supplier_id
  const cdns = await scanTable<any>(TABLES.CREDIT_DEBIT_NOTES);
  const cdnIds = cdns.filter((n) => n.supplier_id === supplierId && filterCompany(n)).map((n) => n.id);
  totalDeleted += await deleteKeys(TABLES.CREDIT_DEBIT_NOTES, cdnIds);

  // 7. Payments — supplier payments stored as customer_id = supplierId or vendor_ prefix variants
  const payments = await scanTable<any>(TABLES.PAYMENTS);
  const payIds = payments.filter((p) => p.customer_id === supplierId && filterCompany(p)).map((p) => p.id);
  totalDeleted += await deleteKeys(TABLES.PAYMENTS, payIds);

  // 8. Advances linked to those purchase POs
  if (poIds.length > 0) {
    const advances = await scanTable<any>(TABLES.ADVANCES);
    const advIds = advances.filter((a) => a.purchase_order_id && poIds.includes(a.purchase_order_id) && filterCompany(a)).map((a) => a.id);
    if (advIds.length > 0) totalDeleted += await deleteKeys(TABLES.ADVANCES, advIds);
  }

  // 9. Stock movements tied to deleted purchase invoices / receipts
  if (piIds.length > 0) {
    const movements = await scanTable<any>(TABLES.STOCK_MOVEMENTS);
    const piSet = new Set(piIds);
    const moveIds = movements.filter((m) => m.purchase_invoice_id && piSet.has(m.purchase_invoice_id) && filterCompany(m)).map((m) => m.id);
    if (moveIds.length > 0) totalDeleted += await deleteKeys(TABLES.STOCK_MOVEMENTS, moveIds);
  }

  // 10. Products where supplier_id matches (optional — delete catalogue items sourced from this supplier)
  const products = await scanTable<any>(TABLES.PRODUCTS);
  const prodIds = products.filter((p) => p.supplier_id === supplierId && filterCompany(p)).map((p) => p.id);
  if (prodIds.length > 0) totalDeleted += await deleteKeys(TABLES.PRODUCTS, prodIds);

  return totalDeleted;
}
