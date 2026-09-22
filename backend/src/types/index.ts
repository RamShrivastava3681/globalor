// ── Enums ──
export type AppRole = "client" | "factor_admin" | "treasury" | "checker" | "operations" | "viewer";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertType = "overdue" | "large_invoice" | "payment_received" | "invoice_created" | "purchase_invoice_created" | "purchase_order_created" | "customer_created" | "vendor_created" | "supplier_created" | "stock_movement_created" | "product_created" | "sales_order_created" | "dispatch_confirmed" | "quotation_created" | "shipment_created" | "shipment_booked" | "shipment_delayed" | "shipment_exception" | "shipment_delivered" | "shipment_cancelled" | "shipment_stale_tracking" | "shipment_eway_expiring" | "shipment_freight_variance";
export type InvoiceStatus = "draft" | "submitted" | "approved" | "advanced" | "paid" | "overdue" | "rejected" | "funded";

/** One entry in an invoice's reminder log — NOA sends and overdue reminders. */
export interface ReminderEntry {
  sent_at: string;
  type: "noa" | "overdue" | "manual";
  to: string;
  note?: string | null;
}

/**
 * Goods line on a sales invoice — snapshotted from the linked sales order.
 * Invoices NEVER reduce stock: only a confirmed dispatch does.
 */
export interface InvoiceLine {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  gst_rate: number | null;
  line_total: number;
}
export type NoaStatus = "not_sent" | "sent" | "accepted" | "rejected" | "commented";
export type PurchaseInvoiceStatus = "draft" | "submitted" | "approved" | "paid" | "overdue" | "disputed" | "advanced" | "funded";

export type AdvanceSide = "sales" | "purchase";
export type MovementDirection = "in" | "out";
export type POStatus = "open" | "proforma" | "invoiced" | "cancelled";
export type ProformaStatus = "none" | "pending_review" | "approved" | "rejected" | "funded";
export type CreditDebitNoteType = "credit" | "debit";
export type CreditDebitNoteStatus = "pending" | "approved" | "rejected" | "received" | "paid";

// ── Document metadata ──
export interface DocMeta {
  path: string;
  name: string;
  type: string;
  size: number;
  uploaded_at: string;
}

// ── Company ──
export interface Company {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  settings: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ── User / Auth ──
export interface User {
  id: string;
  email: string;
  password_hash: string;
  company_id: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string | null;
  company_name: string;
  company_id: string | null;
  contact_name: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
}

// ── Customers ──
/** One saved billing / shipping address on a customer. */
export interface CustomerAddress {
  id: string;
  label: string | null;
  /** Which documents this address may be picked for (billing vs shipping are kept separate). */
  kind: "billing" | "shipping" | "both";
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  is_default: boolean;
}

export interface Customer {
  id: string;
  company_id: string | null;
  name: string;
  legal_entity_name: string | null;
  registration_no: string | null;
  relationship_since: string | null;
  /** @deprecated Registered address removed — use `addresses` (billing / shipping) instead. Kept for reading legacy records. */
  registered_address?: string | null;
  postal_code: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  phone: string | null;
  website: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_designation: string | null;
  contact_phone: string | null;
  industry: string | null;
  payment_terms_days?: number;
  /** Saved billing / shipping addresses (pickable on PO / SO). */
  addresses?: CustomerAddress[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── Vendors ──
export interface Vendor {
  id: string;
  client_id: string;
  company_id: string | null;
  name: string;
  address_line: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
  phone: string | null;
  website: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_designation: string | null;
  contact_phone: string | null;
  industry: string | null;
  payment_terms_days?: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── Suppliers (factor-managed) ──
export interface Supplier {
  id: string;
  company_id: string | null;
  company_name: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  address_line: string | null;
  address_line2: string | null;
  city: string | null;
  state?: string | null;
  country: string | null;
  postal_code: string | null;
  contact_name: string | null;
  contact_designation: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  payment_terms_days?: number;
  advance_rate: number;
  fee_rate: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Invoices (Sales) ──
export interface Invoice {
  id: string;
  client_id: string;
  company_id: string | null;
  customer_id: string;
  /** Legacy link — live DB rows store the customer in `debtor_id` (debtors table).
   *  Always populated alongside `customer_id` on write; read via either. */
  debtor_id?: string | null;
  supplier_id: string | null;
  invoice_number: string;
  amount: number;
  advance_rate: number;
  fee_rate: number;
  amount_received: number | null;
  issue_date: string;
  due_date: string | null;
  paid_date: string | null;
  receipt_date: string | null;
  advance_received_date: string | null;
  short_payment: number | null;
  late_days: number | null;
  paid_note: string | null;
  status: InvoiceStatus;
  payment_type?: "manual_pay" | "mass_upload" | "bulk_pay" | "treasury_pay";
  noa_status: NoaStatus;
  noa_token: string | null;
  noa_sent_at: string | null;
  noa_responded_at: string | null;
  noa_comments: string | null;
  /** When the last overdue reminder email went out (once per day per invoice). */
  last_overdue_reminder_date: string | null;
  /** Chronological reminder history — NOA sends + overdue/manual reminders. */
  reminder_log: ReminderEntry[];
  po_number: string | null;
  po_date: string | null;
  purchase_invoice_ids: string[];
  purchase_order_id: string | null;
  payment_terms_days: number;
  bl_date: string | null;
  due_date_source: "invoice" | "bl";
  has_contractual_due_date: boolean;
  /** ── Goods-invoice fields (wired by the sales-invoice phase) ── */
  goods_sales_order_id?: string | null;
  goods_sales_order_number?: string | null;
  /** Snapshot lines from the linked SO (billing after dispatch). */
  lines?: InvoiceLine[];
  subtotal_goods?: number;
  total_discount?: number;
  gst_total?: number;
  freight?: number | null;
  grand_total?: number;
  /** Max(advances received, grandTotal × advance_rate%) — computed server-side. */
  advance_deducted?: number;
  /** grandTotal − advance_deducted. `amount` is stored as this net figure. */
  net_receivable?: number;
  customer_contact?: string | null;
  billing_address?: string | null;
  delivery_address?: string | null;
  documents: DocMeta[];
  created_at: string;
  updated_at: string;
}

// ── Purchase Invoices ──

/**
 * Goods line on a purchase invoice — snapshotted from the linked goods PO.
 * `grn_received_qty` is back-filled from confirmed GRNs (warn-only qty
 * difference check); `po_unit_price` is the PO price snapshot (warn-only
 * price difference check).
 */
export interface PurchaseInvoiceLine {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  /** PO snapshot. */
  ordered_qty: number;
  /** Back-filled from confirmed GRNs — never typed manually. */
  grn_received_qty: number;
  /** What the supplier actually billed (editable). */
  invoice_qty: number;
  /** Billed price (editable). */
  unit_price: number;
  /** PO price snapshot. */
  po_unit_price: number;
  gst_rate: number | null;
  line_total: number;
}

export interface PurchaseInvoice {
  id: string;
  client_id: string;
  company_id: string | null;
  vendor_id: string;
  invoice_number: string;
  amount: number;
  amount_paid: number | null;
  advance_rate: number;
  po_number: string | null;
  po_date: string | null;
  issue_date: string;
  due_date: string | null;
  paid_date: string | null;
  funded_date: string | null;
  advance_paid_date: string | null;
  paid_note: string | null;
  notes: string | null;
  status: PurchaseInvoiceStatus;
  documents: DocMeta[];
  purchase_order_id: string | null;
  /** Link to a goods PO (Phase 3+ — the PO this invoice bills). */
  goods_purchase_order_id?: string | null;
  /** Snapshot lines from the linked goods PO (back-filled when absent). */
  lines?: PurchaseInvoiceLine[];
  /** Confirmed GRNs that billed against this invoice's PO. */
  linked_goods_receipt_ids?: string[] | null;
  /** Optimistic-concurrency guard for GRN back-fills. */
  version?: number;
  linked_sales_invoice_ids: string[];
  payment_terms_days: number;
  bl_date: string | null;
  due_date_source: "invoice" | "bl";
  has_contractual_due_date?: boolean;
  created_at: string;
  updated_at: string;
}

// ── Purchase Orders / Proformas ──
export interface PurchaseOrder {
  id: string;
  client_id: string;
  company_id: string | null;
  side: AdvanceSide;
  customer_id: string | null;
  vendor_id: string | null;
  po_number: string;
  proforma_number: string | null;
  proforma_date: string | null;
  amount: number;
  currency: string;
  issue_date: string;
  expected_date: string | null;
  status: POStatus;
  proforma_status: ProformaStatus;
  proforma_review_comments: string | null;
  proforma_reviewed_at: string | null;
  proforma_reviewed_by: string | null;
  proforma_funded_amount: number | null;
  proforma_funded_at: string | null;
  proforma_funded_by: string | null;
  proforma_funding_reference: string | null;
  /** Set when converted into a goods doc (Phase 8): "po" | "so" — one-time. */
  converted_to: "po" | "so" | null;
  converted_document_number: string | null;
  converted_at: string | null;
  /**
   * Total advance value already deducted against this proforma across
   * invoices (agreed-% tracking) — prevents double-deducting the agreed
   * advance % on a second invoice for the same proforma.
   */
  advance_deducted?: number;
  notes: string | null;
  documents: DocMeta[];
  has_contractual_due_date?: boolean;
  created_at: string;
  updated_at: string;
}

// ── Goods Purchase Orders (goods PO — distinct from the proforma table) ──
export type GoodsPurchaseOrderStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "partially_received"
  | "fully_received"
  | "cancelled";

export interface GoodsPurchaseOrderLine {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  ordered_qty: number;
  unit_price: number;
  gst_rate: number | null;
  /** Folded from confirmed GRNs — never typed manually. */
  received_qty: number;
  line_total: number;
}

/**
 * The purchase commitment. A PO never touches stock — only a confirmed GRN
 * creates stock-in. Status is derived from `manual_status` + GRN receipts:
 * draft → approved → sent → (partially_received) → fully_received | cancelled.
 */
export interface GoodsPurchaseOrder {
  id: string;
  client_id: string;
  company_id: string | null;
  po_number: string;
  po_date: string;
  /** Supplier OR vendor id (merged dropdowns); name denormalized. */
  supplier_id: string | null;
  supplier_name: string | null;
  /** Billing party (customer) + address picked from the customer master. */
  bill_to_customer_id?: string | null;
  bill_to_customer_name?: string | null;
  billing_address?: string | null;
  /** Shipping party — may differ from billing; falls back to billing when same. */
  ship_to_customer_id?: string | null;
  ship_to_customer_name?: string | null;
  shipping_address?: string | null;
  warehouse: string | null;
  expected_delivery_date: string | null;
  payment_terms: string | null;
  buyer_name: string | null;
  notes: string | null;
  freight: number | null;
  lines: GoodsPurchaseOrderLine[];
  subtotal: number;
  gst_total: number;
  grand_total: number;
  manual_status: "draft" | "pending_approval" | "approved" | "sent" | "cancelled";
  status: GoodsPurchaseOrderStatus;
  documents: DocMeta[];
  /** Checker review trail (maker–checker gate). */
  review_comments?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  /** Client notification (informational only — NOT a gate for GRN/logistics for now). */
  sent_to_client_at?: string | null;
  client_status?: "pending" | "approved" | "rejected" | null;
  client_responded_at?: string | null;
  /** Source supplier proforma this PO was converted from (Phase 8 wiring). */
  linked_proforma_id?: string | null;
  linked_proforma_number?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Optimistic-concurrency guard for GRN folds (bumped by every received-qty recompute). */
  version?: number;
}

// ── Goods Receipts (GRN — the ONLY stock-in document) ──
export type GoodsReceiptStatus = "draft" | "confirmed" | "cancelled";

export interface GoodsReceiptLine {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  /** Snapshot of the PO line. */
  ordered_qty: number;
  received_qty: number;
  /** What enters stock. */
  accepted_qty: number;
  /** Damaged / defective. */
  rejected_qty: number;
  /** Values the stock-in. */
  unit_cost: number;
  gst_rate: number | null;
  line_value: number;
  notes?: string | null;
}

export interface GoodsReceipt {
  id: string;
  client_id: string;
  company_id: string | null;
  receipt_number: string;
  goods_purchase_order_id: string;
  po_number: string | null;
  supplier_name: string | null;
  supplier_address?: string | null;
  billing_address?: string | null;
  shipping_address?: string | null;
  warehouse: string | null;
  received_date: string;
  challan_number: string | null;
  received_by: string | null;
  notes: string | null;
  lines: GoodsReceiptLine[];
  purchase_invoice_id: string | null;
  status: GoodsReceiptStatus;
  created_by: string | null;
  confirmed_by: string | null;
  cancelled_by: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Goods Sales Orders (SO — the commitment, never touches stock) ──
// `confirmed` is legacy-only (pre approval-chain data); it stays dispatchable/invoicable.
export type GoodsSalesOrderStatus =
  | "draft"
  | "pending_warehouse_approval"
  | "pending_checker_approval"
  | "approved"
  | "confirmed"
  | "partially_dispatched"
  | "fully_dispatched"
  | "cancelled";

export interface GoodsSalesOrderLine {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  ordered_qty: number;
  unit_price: number;
  /** 0–100. GST applies to the discounted value. */
  discount_pct: number;
  gst_rate: number | null;
  /** Folded from confirmed dispatches — never typed manually. */
  dispatched_qty: number;
  line_total: number;
  notes?: string | null;
}

/**
 * The sales commitment. An SO never touches stock — only a confirmed dispatch
 * creates stock-out. Status derives from `manual_status` + dispatches:
 * draft → pending_warehouse_approval → pending_checker_approval → approved
 * → (partially_dispatched) → fully_dispatched | cancelled.
 */
export interface GoodsSalesOrder {
  id: string;
  client_id: string;
  company_id: string | null;
  so_number: string;
  order_date: string;
  /** Customer id (merged customer master). */
  customer_id: string | null;
  customer_name: string | null;
  /** Billing party — may differ from the shipping party. */
  billing_customer_id?: string | null;
  billing_customer_name?: string | null;
  /** Shipping party — falls back to the billing party when kept the same. */
  shipping_customer_id?: string | null;
  shipping_customer_name?: string | null;
  contact_person: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  salesperson_name: string | null;
  linked_quotation_id: string | null;
  linked_quotation_number: string | null;
  payment_terms: string | null;
  expected_dispatch_date: string | null;
  expected_delivery_date: string | null;
  notes: string | null;
  lines: GoodsSalesOrderLine[];
  subtotal: number;
  total_discount: number;
  gst_total: number;
  freight: number | null;
  grand_total: number;
  manual_status: "draft" | "pending_warehouse_approval" | "pending_checker_approval" | "approved" | "cancelled";
  status: GoodsSalesOrderStatus;
  documents: DocMeta[];
  /** Approval trail — warehouse sign-off (step 1 of the maker–checker gate). */
  warehouse_review_comments?: string | null;
  warehouse_reviewed_by?: string | null;
  warehouse_reviewed_at?: string | null;
  /** Approval trail — checker review (step 2; approving releases the order). */
  review_comments?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  /** Source customer proforma this SO was converted from (Phase 8 wiring). */
  linked_proforma_id?: string | null;
  linked_proforma_number?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Optimistic-concurrency guard for dispatch folds (bumped by recomputes). */
  version?: number;
}

// ── Goods Dispatches (DSP — the ONLY stock-out document) ──
export type GoodsDispatchStatus = "draft" | "confirmed" | "partially_delivered" | "delivered" | "returned" | "cancelled";

export interface GoodsDispatchLine {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  /** Snapshot of the SO line. */
  ordered_qty: number;
  /** What leaves stock (> 0, never exceeds pending). */
  dispatched_qty: number;
  /** System-maintained from "mark delivered". */
  delivered_qty: number;
  /** System-maintained from "record return". */
  returned_qty: number;
  /** Price snapshot from the SO. */
  unit_price: number;
  discount_pct: number;
  gst_rate: number | null;
  line_value: number;
  notes?: string | null;
}

/**
 * The dispatch note — the only document that reduces inventory. Confirmed
 * dispatches create stock-out; returns credit stock back in; cancelling
 * reverses with stock-in movements. The SO qty is folded on confirm/return/cancel.
 */
export interface GoodsDispatch {
  id: string;
  client_id: string;
  company_id: string | null;
  dispatch_number: string;
  goods_sales_order_id: string;
  so_number: string | null;
  customer_name: string | null;
  billing_customer_name?: string | null;
  billing_address?: string | null;
  shipping_customer_name?: string | null;
  contact_person: string | null;
  delivery_address: string | null;
  warehouse: string | null;
  dispatch_date: string;
  transporter_name: string | null;
  tracking_number: string | null;
  delivery_challan_number: string | null;
  linked_customer_proforma_id: string | null;
  linked_customer_proforma_number: string | null;
  linked_sales_invoice_id: string | null;
  linked_sales_invoice_number: string | null;
  dispatched_by: string | null;
  notes: string | null;
  lines: GoodsDispatchLine[];
  delivery_date: string | null;
  status: GoodsDispatchStatus;
  created_by: string | null;
  confirmed_by: string | null;
  cancelled_by: string | null;
  returned_by: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  returned_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Quotations (the offer — never touches inventory or accounting) ──
export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired" | "converted_to_so";
/** Maker–checker price approval. "none" = no revised prices, review not needed. */
export type QuotationApprovalStatus = "none" | "pending_review" | "approved" | "rejected";
export type QuotationCustomerStatus = "pending" | "approved" | "rejected";

export interface QuotationLine {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  /** Original offered price. */
  unit_price: number;
  /** Maker's revised price — requires checker approval. Effective when set. */
  updated_unit_price: number | null;
  discount_type: "pct" | "amount" | "none";
  discount_value: number;
  gst_rate: number | null;
  notes?: string | null;
}

/**
 * The offer. Three parallel status dimensions (rendered as separate pills):
 * - `status` lifecycle: draft → sent → accepted | rejected | expired → converted_to_so
 * - `approval_status` maker–checker price review: none → pending_review → approved | rejected
 * - `customer_status` emailed secure-token approval: pending → approved | rejected
 */
export interface Quotation {
  id: string;
  client_id: string;
  company_id: string | null;
  quotation_number: string;
  quotation_date: string;
  valid_until: string | null;
  /** Customer id, or null for a free-text prospect. */
  customer_id: string | null;
  prospect_name: string | null;
  customer_name: string | null;
  contact_person: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  salesperson_name: string | null;
  payment_terms: string | null;
  expected_delivery_date: string | null;
  notes: string | null;
  lines: QuotationLine[];
  subtotal: number;
  total_discount: number;
  gst_total: number;
  freight: number | null;
  grand_total: number;
  status: QuotationStatus;
  approval_status: QuotationApprovalStatus;
  approval_comments: string | null;
  approved_by: string | null;
  approved_at: string | null;
  customer_status: QuotationCustomerStatus;
  customer_comments: string | null;
  customer_token: string | null;
  customer_sent_at: string | null;
  customer_responded_at: string | null;
  converted_to_so_id: string | null;
  converted_to_so_number: string | null;
  converted_at: string | null;
  documents: DocMeta[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Advances ──
export interface Advance {
  id: string;
  client_id: string;
  company_id: string | null;
  purchase_order_id: string | null;
  invoice_id: string | null;
  purchase_invoice_id: string | null;
  side: AdvanceSide;
  amount: number;
  advance_date: string;
  reference: string | null;
  notes: string | null;
  status: "open" | "applied" | "refunded";
  created_at: string;
  updated_at: string;
}

// ── Expenses ──
export interface Expense {
  id: string;
  client_id: string;
  company_id: string | null;
  category: string;
  description: string | null;
  amount: number;
  expense_date: string;
  invoice_id: string | null;
  purchase_invoice_id: string | null;
  documents: DocMeta[];
  created_at: string;
  updated_at: string;
}

// ── Products (catalogue master data) ──
export type ProductStatus = "active" | "inactive";
export type BarcodeType = "EAN-13" | "UPC-A" | "QR";

/**
 * Catalogue product — the master data every order, quote, GRN, dispatch,
 * invoice and forecast references. Documents snapshot products into their
 * line items, so deleting a product never corrupts old documents.
 */
export interface Product {
  id: string;
  client_id: string;
  company_id: string | null;
  /** Auto-generated `SKU-XXXXXXXX` when blank at creation. */
  sku: string;
  name: string;
  description: string | null;
  barcode: string | null;
  barcode_type: BarcodeType | null;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  gender: string | null;
  size: string | null;
  color: string | null;
  model: string | null;
  season: string | null;
  image_url: string | null;
  /** Selling price. */
  unit_price: number;
  /** Purchase price. */
  unit_cost: number;
  /** Maximum retail price. */
  mrp: number | null;
  /** Decimal 0.01–0.99; `null` = inherit the catalogue default. */
  minimum_gross_margin_percentage: number | null;
  /** 0/5/12/18/28 presets, any 0–100 accepted. */
  gst_rate: number | null;
  unit_of_measure: string;
  units_per_carton: number | null;
  reorder_level: number | null;
  max_stock: number | null;
  lead_time_days: number;
  safety_stock_days: number;
  supplier_id: string | null;
  supplier_product_code: string | null;
  minimum_order_quantity: number | null;
  order_multiple: number | null;
  hsn_code: string | null;
  status: ProductStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One row per company: the default minimum gross margin products inherit. */
export interface CatalogueSettings {
  id: string;
  company_id: string | null;
  default_minimum_margin: number;
  created_at: string;
  updated_at: string;
}

/**
 * Snapshot of a catalogue product embedded in document line items
 * (PO, GRN, quotation, SO, dispatch, invoice, stock movement).
 */
export interface ProductLine {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  gst_rate: number | null;
}

// ── Stock Movements ──

export type MovementStatus = "draft" | "confirmed" | "cancelled";

/**
 * Why a movement exists. System reasons are created by confirmed GRNs,
 * dispatches and returns; manual reasons are picked by the user.
 * `sale`/`purchase` mark legacy movements created from invoices.
 */
export type MovementReason =
  | "opening_stock"
  | "stock_adjustment"
  | "damage"
  | "samples"
  | "customer_return"
  | "supplier_return"
  | "goods_receipt"
  | "dispatch"
  | "sale"
  | "purchase";

export interface StockMovement {
  id: string;
  client_id: string;
  company_id: string | null;
  direction: MovementDirection;
  item_name: string;
  sku: string | null;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  notes: string | null;
  invoice_id: string | null;
  purchase_invoice_id: string | null;
  movement_date: string;
  created_at: string;
  updated_at: string;
  /** Catalogue product this movement tracks (when created from the catalogue). */
  product_id?: string | null;
  /**
   * draft → only confirmed movements affect the live balance.
   * Missing on legacy rows — treated as `confirmed` at read time.
   */
  status?: MovementStatus | null;
  reason?: MovementReason | null;
  warehouse?: string | null;
  movement_number?: string | null;
  linked_document_type?: string | null;
  linked_document_number?: string | null;
  /** Source-document ids (wired by the GRN/dispatch phases). */
  goods_receipt_id?: string | null;
  goods_dispatch_id?: string | null;
  /** System-created rows (invoices, GRNs, dispatches) are immutable. */
  is_system?: boolean | null;
  created_by?: string | null;
  confirmed_by?: string | null;
  cancelled_by?: string | null;
  confirmed_at?: string | null;
  cancelled_at?: string | null;
}

// ── Alerts ──
export interface Alert {
  id: string;
  client_id: string | null;
  company_id: string | null;
  customer_id: string | null;
  invoice_id: string | null;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  is_read: boolean;
  created_at: string;
  created_by: string | null;
}

// ── JWT Payload ──
export interface JwtPayload {
  sub: string;
  email: string;
  roles: AppRole[];
  company_id: string | null;
  iat?: number;
  exp?: number;
}

// ── Enriched query results (used by frontend) ──
export interface InvoiceWithRelations extends Invoice {
  customer?: Customer;
  client?: Profile;
  purchases?: (PurchaseInvoice & { vendor?: Vendor })[];
}

export interface PurchaseInvoiceWithVendor extends PurchaseInvoice {
  vendor?: Vendor;
}

export interface PurchaseOrderWithParties extends PurchaseOrder {
  customer?: Customer;
  vendor?: Vendor;
}

export interface AdvanceWithRelations extends Advance {
  invoice?: { invoice_number: string; amount: number; customer?: { name: string } };
  purchase?: { invoice_number: string; amount: number; vendor?: { name: string } };
  order?: { po_number: string; amount: number; status: string; customer?: { name: string }; vendor?: { name: string } };
}

export interface ExpenseWithRelations extends Expense {
  invoice?: { invoice_number: string };
  purchase?: { invoice_number: string };
}

export interface StockMovementWithRelations extends StockMovement {
  invoice?: { invoice_number: string };
  purchase?: { invoice_number: string };
  product?: { id: string; name: string; sku: string; image_url: string | null; reorder_level: number | null };
}

// ── Inventory Items (tracking only, not stock movements) ──
// ── Demand forecasting ──
export type ForecastTrend = "up" | "down" | "stable";
export type ForecastMomentum = "accelerating" | "stable" | "declining" | "inactive";
export type ForecastVelocity = "fast_mover" | "medium_mover" | "slow_mover" | "dead";
export type StockoutUrgency = "critical" | "warning" | "safe";

export interface ForecastMonth {
  /** YYYY-MM */
  month: string;
  forecast: number;
  low: number;
  high: number;
  daily_rate: number;
  stock_required: number;
  projected_stock_after: number;
  suggested_order: number;
}

/**
 * One persisted snapshot per product, produced by the shared forecasting
 * engine. Non-finite numbers are stored as null so one quiet SKU can't crash
 * a batch recompute. `full` carries the JSON breakdown for the expandable UI.
 */
export interface ForecastVariable {
  id: string;
  client_id: string;
  company_id: string | null;
  product_id: string;
  sku: string;
  name: string;
  category: string | null;
  image_url: string | null;
  computed_at: string;
  /** Live confirmed stock right now. */
  stock: number | null;
  unit: string | null;
  /** 12-month weighted baseline (units / month). */
  baseline: number | null;
  trend_direction: ForecastTrend;
  trend_slope: number | null;
  trend_r2: number | null;
  /** 6-month horizon. */
  horizon: ForecastMonth[] | null;
  days_of_cover: number | null;
  estimated_stockout_date: string | null;
  reorder_by_date: string | null;
  next_refill_date: string | null;
  stockout_urgency: StockoutUrgency;
  reorder_required: boolean;
  recommended_order_qty: number | null;
  recommended_order_value: number | null;
  momentum: ForecastMomentum;
  velocity: ForecastVelocity;
  suggested_price_change_pct: number | null;
  suggested_price_note: string | null;
  floor_price: number | null;
  /** Last-3-month actual demand for days-of-cover math. */
  recent_demand: number | null;
  /** 12 monthly actuals (YYYY-MM → units, availability-corrected). */
  monthly_demand: { month: string; actual: number; corrected: number; availability: number }[] | null;
  /** Everything for the expandable breakdown panel. */
  full: Record<string, unknown> | null;
  updated_at: string;
}

export interface InventoryItem {
  id: string;
  client_id: string;
  company_id: string | null;
  item: string;
  description: string | null;
  /** SKU from the import — mirrors the linked catalogue product when present. */
  sku?: string | null;
  /** Maximum retail price from the import (product catalogue mirror). */
  mrp?: number | null;
  /** Catalogue product this tracking item mirrors (linked on import). */
  product_id?: string | null;
  closing_quantity: number;
  price_sale: number;
  extended_price: number;
  unit_cost: number;
  extended_cost: number;
  created_at: string;
  updated_at: string;
}

// ── Credit / Debit Notes ──
export interface CreditDebitNote {
  id: string;
  client_id: string;
  company_id: string | null;
  type: CreditDebitNoteType;
  note_number: string;
  date: string;
  amount: number;
  customer_supplier_name: string | null;
  /** Resolved vendor (supplier) id when the note is linked to a supplier. */
  supplier_id: string | null;
  linked_invoice_id: string | null;
  linked_invoice_type: "sales" | "purchase" | null;
  reason: string | null;
  status: CreditDebitNoteStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  settled_at: string | null;
  settled_by: string | null;
  /** True when the note was settled immediately at creation (workflow bypassed). */
  settled_at_creation?: boolean;
  created_at: string;
  updated_at: string;
}

// ── Payment Records (bulk payment reconciliation) ──
export interface PaymentRecord {
  id: string;
  client_id: string;
  company_id: string | null;
  customer_id: string;
  /** Denormalized party name (customer or vendor) — prevents "Unknown" in history. */
  customer_name?: string;
  amount: number;
  payment_date: string;
  remaining: number;
  invoices_closed: number;
  /** Array of invoice data for invoices that were fully closed (paid) by this payment */
  closed_invoices: Array<{ id: string; invoice_number: string; amount: number }>;
  /** Array of invoice data for invoices that were partially paid by this payment */
  partial_invoices?: Array<{ id: string; invoice_number: string; amount_paid: number }>;
  credit_note_ids: string[];
  mode: "manual" | "fifo" | "two_pass_fifo" | "on_account";
  created_at: string;
  updated_at: string;
}

export interface NoaInvoiceResult {
  id: string;
  invoice_number: string;
  amount: number;
  advance_rate: number;
  advance_amount: number;
  issue_date: string;
  due_date: string | null;
  noa_status: NoaStatus;
  noa_comments: string;
  client_company: string;
  customer_name: string;
  customer_contact_name: string;
  customer_contact_email: string;
}

// ── Cash Command Centre (Treasury & Liquidity) ──
// All money fields are plain numbers in dollars (2 decimals). No currency codes.

export type CashAccountType = "BANK" | "CASH" | "MARKETPLACE" | "FIXED_DEPOSIT";
export type CashAccountStatus = "active" | "inactive";

export interface CashAccount {
  id: string;
  client_id: string;
  company_id: string | null;
  name: string;
  type: CashAccountType;
  current_balance: number;
  restricted_balance: number;
  status: CashAccountStatus;
  created_at: string;
  updated_at: string;
}

export type ExpectedFlowStatus = "EXPECTED" | "OVERDUE" | "RECEIVED" | "PAID" | "CANCELLED";

export interface ExpectedInflow {
  id: string;
  client_id: string;
  company_id: string | null;
  type: string;
  amount: number;
  expected_date: string;
  status: ExpectedFlowStatus;
  source: "manual" | "invoice" | "settlement";
  source_id: string | null;
  customer_name: string | null;
  created_at: string;
  updated_at: string;
}

export type ExpectedOutflowType = "SUPPLIER_PAYMENT" | "OPERATIONAL" | "OTHER";

export interface ExpectedOutflow {
  id: string;
  client_id: string;
  company_id: string | null;
  type: ExpectedOutflowType;
  amount: number;
  expected_date: string;
  status: ExpectedFlowStatus;
  supplier_name: string | null;
  created_at: string;
  updated_at: string;
}

export type SettlementStatus = "EXPECTED" | "DELAYED" | "RECEIVED" | "DISPUTED";

export interface MarketplaceSettlement {
  id: string;
  client_id: string;
  company_id: string | null;
  marketplace_name: string;
  net_expected: number;
  expected_date: string;
  actual_date: string | null;
  status: SettlementStatus;
  created_at: string;
  updated_at: string;
}

export type RecurringFrequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL";

export interface RecurringExpense {
  id: string;
  client_id: string;
  company_id: string | null;
  category: string;
  amount: number;
  frequency: RecurringFrequency;
  payment_day: number;
  status: "active" | "paused";
  created_at: string;
  updated_at: string;
}

export type CommitmentStatus = "PENDING" | "APPROVED" | "CANCELLED";

export interface PurchaseCommitment {
  id: string;
  client_id: string;
  company_id: string | null;
  supplier_name: string;
  expected_payment_amount: number;
  expected_payment_date: string;
  status: CommitmentStatus;
  linked_po: string | null;
  created_at: string;
  updated_at: string;
}

export interface TreasurySettings {
  id: string;
  company_id: string | null;
  minimum_buffer: number;
  created_at: string;
  updated_at: string;
}

// ── Logistics module ──
// Booking freight NEVER moves stock. Inbound stock is credited only on goods
// receipt; outbound stock is debited only on confirmed dispatch. A carrier
// marking "delivered" updates the shipment only.

export type ShipmentType = "inbound" | "outbound" | "transfer" | "return";
export type ShipmentLinkedDocType =
  | "goods_purchase_order"
  | "purchase_invoice"
  | "sales_invoice"
  | "goods_dispatch"
  | "manual";
export type ShipmentPriority = "normal" | "urgent" | "critical";
export type ShipmentMode = "road" | "air" | "sea" | "rail" | "courier";
export type ShipmentServiceType = "standard" | "express" | "surface" | "air" | "freight" | "container";
export type ShipmentBorder = "domestic" | "cross_border";
export type FreightPayment = "prepaid" | "to_pay" | "collect" | "third_party";
export type ShipmentStatus =
  | "draft"
  | "quote_requested"
  | "quote_received"
  | "booked"
  | "pickup_scheduled"
  | "picked_up"
  | "in_transit"
  | "at_hub"
  | "at_customs"
  | "customs_hold"
  | "out_for_delivery"
  | "delivered"
  | "delivery_attempt_failed"
  | "delayed"
  | "damaged"
  | "lost"
  | "return_initiated"
  | "returned"
  | "cancelled";
export type TrackingSource = "carrier_api" | "webhook" | "manual";

export interface ShipmentParty {
  name: string;
  contact_person: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  tax_id: string | null;
}

export interface ShipmentDocRef {
  path: string;
  name: string;
  type: string;
  size: number;
  kind: "pod" | "label" | "invoice" | "certificate" | "other";
  uploaded_at: string;
  uploaded_by: string | null;
}

export interface ShipmentEway {
  eway_bill_number: string | null;
  eway_bill_date: string | null;
  eway_validity: string | null;
  transporter_id: string | null;
  vehicle_number: string | null;
  lr_number: string | null;
  delivery_challan_number: string | null;
}

export interface ShipmentCrossBorder {
  exporter_of_record: string | null;
  importer_of_record: string | null;
  iec_number: string | null;
  origin_country: string | null;
  destination_country: string | null;
  incoterms: string | null;
  port_of_loading: string | null;
  port_of_discharge: string | null;
  final_destination: string | null;
  commercial_invoice_number: string | null;
  packing_list_number: string | null;
  shipping_bill_number: string | null;
  bill_of_entry_number: string | null;
  bl_awb_number: string | null;
  certificate_of_origin: boolean;
  customs_broker: string | null;
  customs_status: string | null;
  duty_tax_amount: number;
  seal_number: string | null;
}

export interface Shipment {
  id: string;
  company_id: string | null;
  shipment_number: string;
  shipment_type: ShipmentType;
  linked_doc_type: ShipmentLinkedDocType;
  linked_doc_id: string | null;
  linked_doc_no: string | null;
  priority: ShipmentPriority;
  owner_id: string | null;
  business_unit: string | null;
  sales_channel: string | null;
  status: ShipmentStatus;
  // Parties
  pickup: ShipmentParty;
  pickup_window: string | null;
  pickup_window_from: string | null;
  pickup_window_to: string | null;
  delivery: ShipmentParty;
  requested_delivery_date: string | null;
  // Cargo
  mode: ShipmentMode;
  service_type: ShipmentServiceType;
  border: ShipmentBorder;
  package_count: number;
  actual_weight: number;
  volumetric_weight: number;
  chargeable_weight: number;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  package_unit: string | null;
  package_unit_count: number;
  declared_value: number;
  currency: string;
  goods_description: string | null;
  hs_code: string | null;
  dangerous_goods: boolean;
  insurance_required: boolean;
  handling_notes: string | null;
  internal_notes: string | null;
  // Commercial — booking creates NO payable; linkage only
  freight_payment: FreightPayment;
  estimated_freight: number;
  quoted_freight: number;
  booked_freight: number;
  final_freight: number;
  fuel_surcharge: number;
  insurance_charge: number;
  other_charges: number;
  total_freight: number;
  cost_centre: string | null;
  freight_invoice_id: string | null;
  freight_supplier: string | null;
  freight_payment_status: string | null;
  // Carrier
  provider_id: string | null;
  provider_name: string | null;
  carrier_name: string | null;
  service_level: string | null;
  tracking_number: string | null;
  container_number: string | null;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_mobile: string | null;
  transporter_id: string | null;
  booking_reference: string | null;
  expected_pickup_date: string | null;
  expected_delivery_date: string | null;
  actual_pickup_at: string | null;
  actual_delivery_at: string | null;
  // Compliance blocks
  eway: ShipmentEway;
  cross_border: ShipmentCrossBorder;
  documents: ShipmentDocRef[];
  goods_receipt_id: string | null;
  goods_dispatch_id: string | null;
  last_event_at: string | null;
  last_event_source: TrackingSource | null;
  booking_failure: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export interface ShipmentEvent {
  id: string;
  company_id: string | null;
  shipment_id: string;
  status: ShipmentStatus;
  carrier_raw_status: string | null;
  event_at: string;
  location: string | null;
  description: string | null;
  source: TrackingSource;
  attachment_url: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ShipmentQuote {
  id: string;
  company_id: string | null;
  shipment_id: string;
  provider_id: string | null;
  provider_name: string;
  carrier_name: string | null;
  mode: ShipmentMode;
  service_level: string | null;
  estimated_pickup_date: string | null;
  estimated_delivery_date: string | null;
  transit_days: number | null;
  freight_charge: number;
  fuel_charges: number;
  other_charges: number;
  insurance_charge: number;
  total_cost: number;
  tracking_available: boolean;
  cancellation_terms: string | null;
  is_selected: boolean;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface LogisticsProvider {
  id: string;
  company_id: string | null;
  provider_name: string;
  carrier_name: string | null;
  modes: ShipmentMode[];
  domestic: boolean;
  cross_border: boolean;
  service_areas: string | null;
  integration_status: "manual" | "integrated" | "disabled";
  adapter_key: string;
  account_ref: string | null;
  billing_terms: string | null;
  default_service_level: string | null;
  insurance_option: boolean;
  support_contact: string | null;
  escalation_contact: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShipmentAudit {
  id: string;
  company_id: string | null;
  shipment_id: string;
  action: string;
  old_value: string | null;
  new_value: string | null;
  actor_id: string | null;
  created_at: string;
}

export interface LogisticsSettings {
  company_id: string;
  delay_buffer_days: number;
  stale_tracking_hours: number;
  eway_expiry_warn_hours: number;
  default_provider_id: string | null;
  default_mode: ShipmentMode;
  freight_variance_pct: number;
  pod_grace_hours: number;
  updated_at: string;
}
