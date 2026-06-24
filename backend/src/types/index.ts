// ── Enums ──
export type AppRole = "client" | "factor_admin" | "treasury" | "checker" | "operations";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertType = "overdue" | "credit_limit" | "risk_change" | "large_invoice" | "payment_received" | "invoice_created" | "purchase_invoice_created" | "debtor_created" | "vendor_created" | "supplier_created" | "stock_movement_created";
export type InvoiceStatus = "pending" | "approved" | "advanced" | "paid" | "overdue" | "rejected" | "funded";
export type NoaStatus = "not_sent" | "sent" | "accepted" | "rejected" | "commented";
export type PurchaseInvoiceStatus = "pending" | "approved" | "paid" | "overdue" | "disputed" | "advanced" | "funded";

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

// ── User / Auth ──
export interface User {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string | null;
  company_name: string;
  contact_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
}

// ── Debtors ──
export interface Debtor {
  id: string;
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
  credit_limit: number;
  risk_score: number;
  payment_terms_days?: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── Vendors ──
export interface Vendor {
  id: string;
  client_id: string;
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
  company_name: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  address_line: string | null;
  address_line2: string | null;
  city: string | null;
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
  debtor_id: string;
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
  status: InvoiceStatus;
  noa_status: NoaStatus;
  noa_token: string | null;
  noa_sent_at: string | null;
  noa_responded_at: string | null;
  noa_comments: string | null;
  po_number: string | null;
  po_date: string | null;
  purchase_invoice_ids: string[];
  purchase_order_id: string | null;
  payment_terms_days: number;
  bl_date: string | null;
  due_date_source: "invoice" | "bl";
  documents: DocMeta[];
  created_at: string;
  updated_at: string;
}

// ── Purchase Invoices ──
export interface PurchaseInvoice {
  id: string;
  client_id: string;
  vendor_id: string;
  invoice_number: string;
  amount: number;
  advance_rate: number;
  po_number: string | null;
  po_date: string | null;
  issue_date: string;
  due_date: string | null;
  paid_date: string | null;
  funded_date: string | null;
  advance_paid_date: string | null;
  notes: string | null;
  status: PurchaseInvoiceStatus;
  documents: DocMeta[];
  purchase_order_id: string | null;
  linked_sales_invoice_ids: string[];
  payment_terms_days: number;
  bl_date: string | null;
  due_date_source: "invoice" | "bl";
  created_at: string;
  updated_at: string;
}

// ── Purchase Orders / Proformas ──
export interface PurchaseOrder {
  id: string;
  client_id: string;
  side: AdvanceSide;
  debtor_id: string | null;
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
  notes: string | null;
  documents: DocMeta[];
  created_at: string;
  updated_at: string;
}

// ── Advances ──
export interface Advance {
  id: string;
  client_id: string;
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

// ── Stock Movements ──
export interface StockMovement {
  id: string;
  client_id: string;
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
}

// ── Alerts ──
export interface Alert {
  id: string;
  client_id: string | null;
  debtor_id: string | null;
  invoice_id: string | null;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  is_read: boolean;
  created_at: string;
}

// ── JWT Payload ──
export interface JwtPayload {
  sub: string;
  email: string;
  roles: AppRole[];
  iat?: number;
  exp?: number;
}

// ── Enriched query results (used by frontend) ──
export interface InvoiceWithRelations extends Invoice {
  debtor?: Debtor;
  client?: Profile;
  purchases?: (PurchaseInvoice & { vendor?: Vendor })[];
}

export interface PurchaseInvoiceWithVendor extends PurchaseInvoice {
  vendor?: Vendor;
}

export interface PurchaseOrderWithParties extends PurchaseOrder {
  debtor?: Debtor;
  vendor?: Vendor;
}

export interface AdvanceWithRelations extends Advance {
  invoice?: { invoice_number: string; amount: number; debtor?: { name: string } };
  purchase?: { invoice_number: string; amount: number; vendor?: { name: string } };
  order?: { po_number: string; amount: number; status: string; debtor?: { name: string }; vendor?: { name: string } };
}

export interface ExpenseWithRelations extends Expense {
  invoice?: { invoice_number: string };
  purchase?: { invoice_number: string };
}

export interface StockMovementWithRelations extends StockMovement {
  invoice?: { invoice_number: string };
  purchase?: { invoice_number: string };
}

// ── Credit / Debit Notes ──
export interface CreditDebitNote {
  id: string;
  client_id: string;
  type: CreditDebitNoteType;
  note_number: string;
  date: string;
  amount: number;
  debtor_supplier_name: string | null;
  linked_invoice_id: string | null;
  linked_invoice_type: "sales" | "purchase" | null;
  reason: string | null;
  status: CreditDebitNoteStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  settled_at: string | null;
  settled_by: string | null;
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
  debtor_name: string;
  debtor_contact_name: string;
  debtor_contact_email: string;
}
