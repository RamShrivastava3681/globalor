# Detailed API Documentation

## Base URL

All endpoints are prefixed with `/api`.


### accounts

**Base Path:** `/api/accounts`

#### `GET /`

#### `GET /:id`

#### `POST /`

#### `PATCH /:id`

#### `GET /trial-balance`

#### `DELETE /:id`


### admin

**Base Path:** `/api/admin`

#### `POST /users`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  company_name: z.string().min(1),
  contact_name: z.string().optional(),
  role: z.enum(["client", "factor_admin", "treasury", "checker", "operations", "viewer"]),
})
```

#### `GET /profiles`
- **Authentication:** Required

#### `GET /roles`
- **Authentication:** Required

#### `POST /roles`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const upsertRoleSchema = z.object({
  user_id: z.string().min(1),
  role: z.enum(["client", "factor_admin", "treasury", "checker", "operations", "viewer"]),
  add: z.boolean(),
})
```

#### `DELETE /users/:userId`
- **Authentication:** Required

#### `POST /generate-alerts`
- **Authentication:** Required


### advances

**Base Path:** `/api/advances`

#### `GET /`
- **Authentication:** Required

#### `POST /`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const createSchema = z.object({
  side: z.enum(["sales", "purchase"]),
  amount: z.number().positive(),
  advance_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  reference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  purchase_order_id: z.string().nullable().optional(),
  invoice_id: z.string().nullable().optional(),
  purchase_invoice_id: z.string().nullable().optional(),
})
```

#### `PATCH /:id`
- **Authentication:** Required

#### `POST /batch`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const batchCreateSchema = z.object({
  items: z.array(z.object({
    amount: z.number().positive(),
    invoice_number: z.string().min(1).max(80),
    advance_date: z.string().min(1),
    reference: z.string().nullable().optional(),
  })).min(1),
})
```

#### `DELETE /:id`
- **Authentication:** Required


### alerts

**Base Path:** `/api/alerts`

#### `GET /`
- **Authentication:** Required

#### `POST /`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const createAlertSchema = z.object({
  client_id: z.string().nullable().optional(),
  debtor_id: z.string().nullable().optional(),
  invoice_id: z.string().nullable().optional(),
  type: z.enum(["overdue", "large_invoice", "payment_received"]),
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string().min(1),
})
```

#### `PATCH /:id/read`
- **Authentication:** Required


### auth

**Base Path:** `/api/auth`

#### `POST /signup`
- **Request Body Schema:**
```typescript
const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  company_name: z.string().min(1),
  contact_name: z.string().optional(),
})
```

#### `POST /signin`
- **Request Body Schema:**
```typescript
const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
```

#### `GET /me`
- **Authentication:** Required

#### `POST /refresh-token`
- **Authentication:** Required

#### `POST /ping`
- **Authentication:** Required


### balanceSheet

**Base Path:** `/api/reports/balance-sheet`

#### `GET /`
- **Authentication:** Required
- Computes the balance sheet from journal entries, invoice balances, advances, and credit/debit notes.
- The `Creditors: amounts falling due within one year` section includes a **`Credit Notes Payable`** subsection: the total of purchase credit notes (linked to purchase invoices or unlinked) that have not yet reduced an invoice amount. Its `total` is negative and reduces `totalCreditorsOneYear`. Notes that already lowered their linked invoice's amount (legacy PATCH-settled, or auto-settled at creation with a linked invoice) are excluded; notes settled via bulk payment (`PAYMENTS.credit_note_ids`), unlinked notes, and any remaining pending/approved notes are included.

#### `GET /section-transactions`
- **Authentication:** Required

#### `GET /account-transactions/:accountId`
- **Authentication:** Required


### balanceSheetItems

**Base Path:** `/api/balance-sheet-items`

#### `GET /`
- **Authentication:** Required

#### `GET /:id`
- **Authentication:** Required

#### `POST /`
- **Authentication:** Required

#### `PATCH /:id`
- **Authentication:** Required

#### `DELETE /:id`
- **Authentication:** Required


### bulkPayments

**Base Path:** `/api/bulk-payments`

#### `POST /process`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const processSchema = z.object({
  debtor_id: z.string().min(1),
  payment_date: z.string().min(1),
  amount: z.number().positive(),
  use_balance: z.boolean().optional().default(false),
  mode: z.enum(["manual", "fifo", "two_pass_fifo"]),
  selected_invoice_ids: z.array(z.string()).optional().default([]),
  settle_credit_note_ids: z.array(z.string()).optional().default([]),
})
```

#### `GET /balance/:debtorId`
- **Authentication:** Required

#### `GET /history`
- **Authentication:** Required

#### `POST /reverse/:paymentId`
- **Authentication:** Required

#### `POST /process-purchase`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const processPurchaseSchema = z.object({
  vendor_id: z.string().min(1),
  payment_date: z.string().min(1),
  amount: z.number().positive(),
  use_balance: z.boolean().optional().default(false),
  mode: z.enum(["manual", "fifo", "two_pass_fifo"]),
  selected_invoice_ids: z.array(z.string()).optional().default([]),
  settle_credit_note_ids: z.array(z.string()).optional().default([]),
})
```

#### `GET /purchase-balance/:vendorId`
- **Authentication:** Required


### companies

**Base Path:** `/api/companies`

#### `GET /`
- **Authentication:** Required


### creditDebitNotes

**Base Path:** `/api/credit-debit-notes`

#### `GET /`
- **Authentication:** Required

#### `POST /`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const createSchema = z.object({
  type: z.enum(["credit", "debit"]),
  note_number: z.string().min(1).max(80),
  date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  amount: z.number().positive(),
  debtor_supplier_name: z.string().max(200).nullable().optional(),
  supplier_name: z.string().max(200).nullable().optional(),
  linked_invoice_id: z.string().nullable().optional(),
  linked_invoice_type: z.enum(["sales", "purchase"]).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
})
```
- **Immediate settlement:** the checker → funding-queue workflow is bypassed. Notes are created as **`received`** (credit) or **`paid`** (debit) with `settled_at_creation: true`, and a linked invoice amount is adjusted immediately (credit → reduced, debit → increased, credit clamped at 0). The note is stored with `reviewed_at`/`reviewed_by` null.
- **`supplier_name`:** resolved against the company's vendors (case-insensitive); unknown names auto-create a vendor (same behavior as batch).

#### `PATCH /:id`
- **Authentication:** Required
- Kept for legacy pending/approved notes. Approval (`approved`/`rejected`) and settlement (`received`/`paid`, which adjusts the linked invoice) work as before; notes created via the new flow are already settled and cannot be re-settled.

#### `POST /batch`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const batchCreateSchema = z.object({
  type: z.enum(["credit", "debit"]),
  notes: z.array(z.object({
    note_number: z.string().min(1).max(80),
    date: z.string().optional(),
    amount: z.number().positive(),
    debtor_supplier_name: z.string().max(200).nullable().optional(),
    supplier_name: z.string().max(200).nullable().optional(),
    linked_invoice_number: z.string().max(80).nullable().optional(),
    reason: z.string().max(500).nullable().optional(),
  })).min(1).max(500),
})
```
- **`supplier_name` behavior:** each row's supplier name is resolved against the company's vendors (case-insensitive). Existing vendors are matched; unknown names auto-create a new vendor record. The resolved vendor id is stored on the note as `supplier_id`. When a `supplier_name` is provided together with a `linked_invoice_number`, a purchase invoice belonging to that supplier is preferred for the link.
- **Immediate settlement:** same as single create — notes are created as `received`/`paid` with `settled_at_creation: true`, and each linked invoice's amount is adjusted right away.
- **Response additions:** `suppliers_matched` and `suppliers_created` arrays (`{ supplier_name, supplier_id }`) reporting which suppliers were linked vs auto-created.

#### `DELETE /:id`
- **Authentication:** Required
- Pending notes (no effect yet) can be deleted freely. Notes auto-settled at creation (`settled_at_creation: true`) can also be deleted — the linked invoice amount is **reversed** automatically (credit → amount added back, debit → amount subtracted back). Notes settled through the legacy review flow cannot be deleted.


### debtors

**Base Path:** `/api/debtors`

#### `GET /`
- **Authentication:** Required

#### `GET /:id`
- **Authentication:** Required

#### `POST /`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const createDebtorSchema = z.object({
  name: z.string().min(1).max(200),
  legal_entity_name: z.string().max(200).nullable().optional(),
  registration_no: z.string().max(100).nullable().optional(),
  relationship_since: z.string().nullable().optional(),
  industry: z.string().max(100).nullable().optional(),

  registered_address: z.string().max(500).nullable().optional(),
  postal_code: z.string().max(20).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  contact_name: z.string().max(120).nullable().optional(),
  contact_email: z.string().email().nullable().optional().or(z.literal("")),
  contact_designation: z.string().max(120).nullable().optional(),
  contact_phone: z.string().max(40).nullable().optional(),
  notes: z.string().nullable().optional(),
})
```

#### `PATCH /:id`
- **Authentication:** Required

#### `DELETE /:id`
- **Authentication:** Required


### expenses

**Base Path:** `/api/expenses`

#### `GET /`
- **Authentication:** Required

#### `POST /`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const createSchema = z.object({
  category: z.string().min(1),
  description: z.string().nullable().optional(),
  amount: z.number(),
  expense_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  invoice_id: z.string().nullable().optional(),
  purchase_invoice_id: z.string().nullable().optional(),
  documents: z.array(z.any()).optional().default([]),
})
```

#### `DELETE /:id`
- **Authentication:** Required


### inventoryItems

**Base Path:** `/api/inventory-items`

#### `GET /`
- **Authentication:** Required

#### `POST /batch`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const batchCreateSchema = z.object({
  items: z.array(z.object({
    item: z.string().min(1, "Item name is required"),
    description: z.string().optional().nullable().default(""),
    closing_quantity: z.number().min(0, "Closing quantity must be >= 0"),
    price_sale: z.number().min(0, "Price sale must be >= 0"),
    unit_cost: z.number().min(0, "Unit cost must be >= 0"),
  })).min(1, "At least one item is required"),
})
```

#### `DELETE /:id`
- **Authentication:** Required


### invoices

**Base Path:** `/api/invoices`

#### `GET /check-duplicates`
- **Authentication:** Required

#### `GET /`
- **Authentication:** Required

#### `GET /mini`
- **Authentication:** Required

#### `GET /by-purchase/:purchaseInvoiceId`
- **Authentication:** Required

#### `POST /`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const createInvoiceSchema = z.object({
  debtor_id: z.string().min(1),
  invoice_number: z.string().min(1).max(80),
  amount: z.number(),
  advance_rate: z.number().min(0).max(100).optional().default(0),
  fee_rate: z.number().min(0).optional().default(0),
  issue_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  due_date: z.string().nullable().optional(),
  payment_terms_days: z.number().min(0).optional().default(30),
  bl_date: z.string().nullable().optional(),
  due_date_source: z.enum(["invoice", "bl"]).optional().default("invoice"),
  has_contractual_due_date: z.boolean().optional().default(false),
  po_number: z.string().max(80).nullable().optional(),
  po_date: z.string().nullable().optional(),
  purchase_invoice_ids: z.array(z.string()).optional().default([]),
  documents: z.array(z.any()).optional().default([]),
  inventory_items: z.array(z.object({
    item_name: z.string().min(1),
    sku: z.string().nullable().optional(),
    quantity: z.number().positive(),
    unit: z.string().optional().default("unit"),
    unit_cost: z.number().nullable().optional(),
  })).optional(),
})
```

#### `GET /:id`
- **Authentication:** Required

#### `POST /:id/submit`
- **Authentication:** Required

#### `PATCH /:id`
- **Authentication:** Required

#### `DELETE /:id`
- **Authentication:** Required

#### `POST /bulk-delete`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
})
```

#### `POST /batch`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const batchInvoiceSchema = z.object({
  debtor_id: z.string().min(1),
  payment_terms_days: z.number().min(0).optional().default(30),
  due_date_source: z.enum(["invoice", "bl"]).optional().default("invoice"),
  bl_date: z.string().nullable().optional(),
  has_contractual_due_date: z.boolean().optional().default(false),
  po_number: z.string().max(80).nullable().optional().default(null),
  po_date: z.string().nullable().optional().default(null),
  advance_rate: z.number().min(0).max(100).optional().default(0),
  fee_rate: z.number().min(0).optional().default(0),
  invoices: z.array(z.object({
    invoice_number: z.string().min(1).max(80),
    amount: z.number(),
    issue_date: z.string().min(1),
  })).min(1),
})
```

#### `POST /batch-close`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const batchCloseSchema = z.object({
  paid_note: z.string().nullable().optional().default(null),
  items: z.array(z.object({
    invoice_number: z.string().min(1),
    date_received: z.string().min(1),
    amount_received: z.number().min(0),
    paid_note: z.string().nullable().optional().default(null),
  })).min(1),
})
```

#### `POST /bulk-pay`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const bulkPaySchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    invoice_number: z.string().min(1),
    date_received: z.string().min(1),
    amount_received: z.number().min(0),
  })).min(1),
})
```

#### `POST /parse-invoice`
- **Authentication:** Required

#### `POST /bulk-search`
- **Authentication:** Required

#### `POST /:id/send-noa`
- **Authentication:** Required


### journalEntries

**Base Path:** `/api/journal-entries`

#### `GET /`

#### `GET /:id`

#### `POST /`

#### `PATCH /:id`

#### `DELETE /:id`


### noa

**Base Path:** `/api/noa`

#### `GET /:token`

#### `POST /:token/respond`


### payments

**Base Path:** `/api/payments`

#### `GET /history`
- **Authentication:** Required


### profiles

**Base Path:** `/api/profiles`

#### `GET /me`
- **Authentication:** Required

#### `PATCH /me`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const updateProfileSchema = z.object({
  company_name: z.string().min(1).optional(),
  contact_name: z.string().nullable().optional(),
})
```


### purchaseInvoices

**Base Path:** `/api/purchase-invoices`

#### `GET /`
- **Authentication:** Required

#### `GET /mini`
- **Authentication:** Required

#### `GET /:id`
- **Authentication:** Required

#### `POST /`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const createSchema = z.object({
  vendor_id: z.string().min(1),
  invoice_number: z.string().min(1).max(80),
  amount: z.number(),
  po_number: z.string().max(80).nullable().optional(),
  po_date: z.string().nullable().optional(),
  issue_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  due_date: z.string().nullable().optional(),
  payment_terms_days: z.number().min(0).optional().default(30),
  bl_date: z.string().nullable().optional(),
  due_date_source: z.enum(["invoice", "bl"]).optional().default("invoice"),
  has_contractual_due_date: z.boolean().optional().default(false),
  notes: z.string().nullable().optional(),
  linked_sales_invoice_ids: z.array(z.string()).optional().default([]),
  documents: z.array(z.any()).optional().default([]),
  inventory_items: z.array(z.object({
    item_name: z.string().min(1),
    sku: z.string().nullable().optional(),
    quantity: z.number().positive(),
    unit: z.string().optional().default("unit"),
    unit_cost: z.number().nullable().optional(),
  })).optional(),
})
```

#### `PATCH /:id`
- **Authentication:** Required

#### `POST /batch`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const batchPurchaseInvoiceSchema = z.object({
  vendor_id: z.string().min(1),
  payment_terms_days: z.number().min(0).optional().default(30),
  due_date_source: z.enum(["invoice", "bl"]).optional().default("invoice"),
  has_contractual_due_date: z.boolean().optional().default(false),
  bl_date: z.string().nullable().optional(),
  po_number: z.string().max(80).nullable().optional().default(null),
  po_date: z.string().nullable().optional().default(null),
  invoices: z.array(z.object({
    invoice_number: z.string().min(1).max(80),
    amount: z.number(),
    issue_date: z.string().min(1),
  })).min(1),
})
```

#### `POST /batch-close`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const batchCloseSchema = z.object({
  items: z.array(z.object({
    invoice_number: z.string().min(1),
    date_received: z.string().min(1),
    amount_received: z.number().min(0),
    paid_note: z.string().nullable().optional().default(null),
  })).min(1),
})
```

#### `POST /bulk-search`
- **Authentication:** Required

#### `POST /:id/submit`
- **Authentication:** Required

#### `DELETE /:id`
- **Authentication:** Required


### purchaseOrders

**Base Path:** `/api/purchase-orders`

#### `GET /`
- **Authentication:** Required

#### `GET /by-po/:poNumber`
- **Authentication:** Required

#### `POST /`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const createSchema = z.object({
  side: z.enum(["sales", "purchase"]),
  debtor_id: z.string().nullable().optional(),
  vendor_id: z.string().nullable().optional(),
  po_number: z.string().min(1).max(80),
  proforma_number: z.string().min(1).max(80).optional(),
  proforma_date: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().optional().default("USD"),
  notes: z.string().nullable().optional(),
  has_contractual_due_date: z.boolean().optional().default(false),
  documents: z.array(z.any()).optional().default([]),
})
```

#### `PATCH /:id`
- **Authentication:** Required

#### `DELETE /:id`
- **Authentication:** Required

#### `POST /batch`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const batchProformaSchema = z.object({
  side: z.enum(["sales", "purchase"]),
  debtor_id: z.string().nullable().optional(),
  vendor_id: z.string().nullable().optional(),
  items: z.array(z.object({
    proforma_number: z.string().min(1).max(80),
    proforma_date: z.string().min(1),
    po_number: z.string().min(1).max(80),
    amount: z.number().positive(),
  })).min(1),
})
```

#### `POST /:id/review`
- **Authentication:** Required

#### `POST /:id/fund`
- **Authentication:** Required


### reports

**Base Path:** `/api/reports`

#### `GET /sales-invoices`
- **Authentication:** Required

#### `GET /purchase-invoices`
- **Authentication:** Required

#### `GET /proformas`
- **Authentication:** Required

#### `GET /aging`
- **Authentication:** Required

#### `GET /debtors`
- **Authentication:** Required

#### `GET /suppliers`
- **Authentication:** Required

#### `GET /advances`
- **Authentication:** Required

#### `GET /expenses`
- **Authentication:** Required

#### `GET /portfolio`
- **Authentication:** Required

#### `GET /profit-loss`
- **Authentication:** Required
- Query params: `from`, `to` (YYYY-MM-DD, optional).
- Response additions under Cost of Sales:
  - `purchaseReturns`: total of purchase credit notes (linked to purchase invoices or unlinked) that have not yet reduced an invoice amount — deducted from cost of purchases.
  - `netPurchases`: `grossPurchases - purchaseReturns`. `totalCostOfSales` is computed from `netPurchases`.
- Notes that already lowered their linked invoice's amount are excluded from `purchaseReturns`: notes settled via the legacy PATCH flow and notes auto-settled at creation with a linked invoice (the new immediate-settlement flow). Notes settled via bulk payment (`PAYMENTS.credit_note_ids`), unlinked notes, and any remaining pending/approved notes are included.

#### `GET /credit-notes`
- **Authentication:** Required
- Query params: `from`, `to` (YYYY-MM-DD, optional).
- Returns credit-note totals for dashboard KPIs, computed with the same shared logic as `/profit-loss` and the balance sheet:
  - `salesReturns`: total of credit notes linked to sales invoices — reduces turnover.
  - `purchaseReturns`: total of unapplied purchase credit notes — reduces cost of purchases (same exclusion rules as `/profit-loss`).
  - `unappliedNotesCount`: number of purchase credit notes not yet applied to an invoice.
  - `applicableNotesCount`: number of purchase credit notes in range.

#### `GET /inventory-tracking`
- **Authentication:** Required


### stockMovements

**Base Path:** `/api/stock-movements`

#### `GET /`
- **Authentication:** Required

#### `POST /`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const createSchema = z.object({
  direction: z.enum(["in", "out"]),
  item_name: z.string().min(1),
  sku: z.string().nullable().optional(),
  quantity: z.number().positive(),
  unit: z.string().optional().default("unit"),
  unit_cost: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  invoice_id: z.string().nullable().optional(),
  purchase_invoice_id: z.string().nullable().optional(),
  movement_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
})
```

#### `DELETE /:id`
- **Authentication:** Required


### suppliers

**Base Path:** `/api/suppliers`

#### `GET /`
- **Authentication:** Required

#### `POST /`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const createSupplierSchema = z.object({
  company_name: z.string().min(1).max(200),
  industry: z.string().max(100).nullable().optional(),
  website: z.string().url().nullable().optional().or(z.literal("")),
  phone: z.string().max(40).nullable().optional(),
  address_line: z.string().max(300).nullable().optional(),
  address_line2: z.string().max(300).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  postal_code: z.string().max(20).nullable().optional(),
  contact_name: z.string().max(120).nullable().optional(),
  contact_designation: z.string().max(120).nullable().optional(),
  contact_email: z.string().email().nullable().optional().or(z.literal("")),
  contact_phone: z.string().max(40).nullable().optional(),
  advance_rate: z.number().min(0).max(1).optional().default(0.8),
  fee_rate: z.number().min(0).max(1).optional().default(0.025),
  notes: z.string().nullable().optional(),
})
```

#### `PATCH /:id`
- **Authentication:** Required

#### `DELETE /:id`
- **Authentication:** Required


### upload

**Base Path:** `/api/upload`

#### `DELETE /`
- **Authentication:** Required

#### `GET /signed-url/**`


### vendors

**Base Path:** `/api/vendors`

#### `GET /`
- **Authentication:** Required

#### `POST /`
- **Authentication:** Required
- **Request Body Schema:**
```typescript
const createVendorSchema = z.object({
  name: z.string().min(1).max(200),
  industry: z.string().max(100).nullable().optional(),
  address_line: z.string().max(300).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  postal_code: z.string().max(20).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  contact_name: z.string().max(120).nullable().optional(),
  contact_email: z.string().email().nullable().optional().or(z.literal("")),
  contact_designation: z.string().max(120).nullable().optional(),
  contact_phone: z.string().max(40).nullable().optional(),
})
```

#### `PATCH /:id`
- **Authentication:** Required

#### `DELETE /:id`
- **Authentication:** Required

