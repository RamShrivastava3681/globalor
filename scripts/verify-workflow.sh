#!/bin/bash
# End-to-end My Queue workflow verification.
# Creates demo customer + supplier + sales/purchase orders, walks every
# queue transition, and prints the task state after each step.
set -u
BASE="http://localhost:4444/api"
PASS=0; FAIL=0
EMAIL="qaverify-$(date +%s)@demo.local"
TS=$(date +%s)

req() { # method path json
  local m=$1 p=$2 b=${3:-}
  if [ -n "$b" ]; then curl -s -m 20 -X "$m" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$b" "$BASE$p"
  else curl -s -m 20 -X "$m" -H "Authorization: Bearer $TOKEN" "$BASE$p"; fi
}
jqget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const get=(o,p)=>p.split('.').reduce((a,k)=>a==null?a:a[k],o);const v=get(o,'$1');console.log(v===undefined?'':(typeof v==='object'?JSON.stringify(v):v));}catch(e){console.log('PARSE_ERR')}})"; }

# ── assert helpers (retry a few times: DynamoDB scans are eventually consistent) ──
count_task() { # stage owner_role doc_type doc_id → stdout count
  local stage=$1 owner=$2 dtype=$3 did=$4
  req GET "/workflow-tasks?status=open" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d);console.log(t.filter(x=>x.stage==='$stage'&&x.owner_role==='$owner'&&x.doc_type==='$dtype'&&x.doc_id==='$did').length)})"
}
expect_task() { # stage owner_role doc_type doc_id
  local stage=$1 owner=$2 dtype=$3 did=$4 n=0
  for i in 1 2 3 4; do n=$(count_task "$stage" "$owner" "$dtype" "$did"); [ "${n:-0}" -ge 1 ] && break; sleep 1.5; done
  if [ "${n:-0}" -ge 1 ]; then echo "  ✅ task [$stage/$owner] open"; PASS=$((PASS+1));
  else echo "  ❌ task [$stage/$owner] MISSING (doc_type=$dtype doc_id=$did)"; FAIL=$((FAIL+1)); fi
}
expect_no_task() {
  local stage=$1 owner=$2 dtype=$3 did=$4 n=1
  for i in 1 2 3 4; do n=$(count_task "$stage" "$owner" "$dtype" "$did"); [ "${n:-0}" -eq 0 ] && break; sleep 1.5; done
  if [ "${n:-0}" -eq 0 ]; then echo "  ✅ task [$stage/$owner] correctly closed"; PASS=$((PASS+1));
  else echo "  ❌ task [$stage/$owner] still open (expected closed)"; FAIL=$((FAIL+1)); fi
}
extract() { echo "$1" | jqget "$2"; }

echo "════ 0. Signup demo company admin ════"
SIGNUP=$(curl -s -m 20 -X POST -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"Passw0rd!123\",\"company_name\":\"QA Demo Co\"}" "$BASE/auth/signup")
TOKEN=$(extract "$SIGNUP" "token"); UID_=$(extract "$SIGNUP" "user.id")
[ -z "$TOKEN" ] && { echo "signup failed: $SIGNUP"; exit 1; }
echo "  ✅ signed up $EMAIL"

echo "════ 1. Demo masters: customer + supplier ════"
CUST=$(req POST /customers "{\"name\":\"Acme Retail $TS\",\"contact_name\":\"Ada Buyer\",\"contact_email\":\"ada@acme.test\"}")
CID=$(extract "$CUST" "id")
echo "  customer: $CID"
SUP=$(req POST /suppliers "{\"company_name\":\"Globex Supply $TS\",\"contact_name\":\"Sam Seller\"}")
SID=$(extract "$SUP" "id")
echo "  supplier: $SID"
if [ -n "$CID" ] && [ -n "$SID" ]; then echo "  ✅ demo customer + supplier created"; PASS=$((PASS+1)); else echo "  ❌ master creation failed: $CUST / $SUP"; FAIL=$((FAIL+1)); fi

echo "════ 2. SALES FLOW (standard terms) ════"
# 2.1 Create draft SO (payment_terms Net 30 — NOT advance)
SO=$(req POST /goods-sales-orders "{\"customer_id\":\"$CID\",\"payment_terms\":\"Net 30\",\"lines\":[{\"name\":\"Widget A\",\"sku\":\"WID-A\",\"ordered_qty\":10,\"unit_price\":100,\"discount_pct\":0,\"gst_rate\":18}]}")
SOID=$(extract "$SO" "id"); SONO=$(extract "$SO" "so_number")
echo "  created SO $SONO ($SOID)"
expect_task submit sales sales_order "$SOID"

# 2.2 Submit → warehouse approval task
req POST "/goods-sales-orders/$SOID/submit" "{}" > /dev/null
expect_task warehouse_approve warehouse sales_order "$SOID"

# 2.3 Warehouse-approve → checker approval task
req POST "/goods-sales-orders/$SOID/warehouse-approve" "{}" > /dev/null
expect_task checker_approve checker sales_order "$SOID"

# 2.4 Checker-approve → dispatch/invoice task (standard terms)
req POST "/goods-sales-orders/$SOID/approve" "{}" > /dev/null
expect_task dispatch_invoice sales sales_order "$SOID"
expect_no_task checker_approve checker sales_order "$SOID"

# 2.5 Make invoice from SO → review task (finance); SO task closes
INV=$(req POST /invoices/from-so "{\"goods_sales_order_id\":\"$SOID\",\"lines\":[{\"sku\":\"WID-A\",\"name\":\"Widget A\",\"quantity\":10,\"unit_price\":100,\"gst_rate\":18}]}")
INVID=$(extract "$INV" "id"); INVNO=$(extract "$INV" "invoice_number")
echo "  created invoice $INVNO ($INVID)"
expect_task review finance sales_invoice "$INVID"
expect_no_task dispatch_invoice sales sales_order "$SOID"

# 2.6 Submit invoice → checker approval task
req POST "/invoices/$INVID/submit" "{}" > /dev/null
expect_task approve checker sales_invoice "$INVID"

# 2.7 Checker approves → treasury records UTR
curl -s -m 20 -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"status":"approved"}' "$BASE/invoices/$INVID" > /dev/null
expect_task record_utr treasury sales_invoice "$INVID"
expect_no_task approve checker sales_invoice "$INVID"

# 2.8 Payment recorded → invoice closes out of the queue
curl -s -m 20 -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"amount_received\":$(node -e "console.log(10*100*1.18)"),\"receipt_date\":\"2026-09-24\",\"payment_type\":\"manual_pay\"}" "$BASE/invoices/$INVID/payment" > /dev/null
expect_no_task record_utr treasury sales_invoice "$INVID"

echo "════ 3. SALES FLOW (Advance payment terms → proforma track) ════"
SO2=$(req POST /goods-sales-orders "{\"customer_id\":\"$CID\",\"payment_terms\":\"Advance\",\"lines\":[{\"name\":\"Widget B\",\"sku\":\"WID-B\",\"ordered_qty\":5,\"unit_price\":200,\"discount_pct\":0,\"gst_rate\":18}]}")
SOID2=$(extract "$SO2" "id"); SONO2=$(extract "$SO2" "so_number")
echo "  created SO $SONO2 ($SOID2)"
req POST "/goods-sales-orders/$SOID2/submit" "{}" > /dev/null
req POST "/goods-sales-orders/$SOID2/warehouse-approve" "{}" > /dev/null
req POST "/goods-sales-orders/$SOID2/approve" "{}" > /dev/null
expect_task create_proforma sales sales_order "$SOID2"

# 2-adv. Maker creates the sales proforma from the SO
PF=$(req POST /purchase-orders "{\"side\":\"sales\",\"customer_id\":\"$CID\",\"po_number\":\"SO-$SONO2\",\"proforma_number\":\"PF-$SONO2\",\"amount\":1000}")
PFID=$(extract "$PF" "id")
echo "  created sales proforma PF-$SONO2 ($PFID)"
expect_task approve checker proforma "$PFID"

# 2-adv. Checker approves the proforma → funding (treasury) via queue
req POST "/purchase-orders/$PFID/review" "{\"decision\":\"approved\"}" > /dev/null
expect_task convert sales proforma "$PFID"

# 2-adv. Treasury funds the advance → proforma leaves queue, convert task re-opens for the maker
req POST "/purchase-orders/$PFID/fund" "{\"amount\":200,\"reference\":\"ADV-001\",\"advance_date\":\"2026-09-24\"}" > /dev/null
expect_task convert sales proforma "$PFID"
FUNDED_COUNT=0
for i in 1 2 3 4; do
  FUNDED_COUNT=$(req GET "/workflow-tasks?status=open" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d);console.log(t.filter(x=>x.doc_type==='proforma'&&x.doc_id==='$PFID'&&x.doc_status==='funded').length)})")
  [ "${FUNDED_COUNT:-0}" -ge 1 ] && break; sleep 1.5
done
[ "${FUNDED_COUNT:-0}" -ge 1 ] && { echo "  ✅ convert task is doc_status=funded (post-funding hop)"; PASS=$((PASS+1)); } || { echo "  ❌ convert task not marked funded"; FAIL=$((FAIL+1)); }
expect_no_task approve checker proforma "$PFID"

echo "════ 4. PURCHASE FLOW ════"
PO=$(req POST /goods-purchase-orders "{\"supplier_id\":\"$SID\",\"payment_terms\":\"Net 30\",\"lines\":[{\"name\":\"Gadget X\",\"sku\":\"GAD-X\",\"ordered_qty\":20,\"unit_price\":50,\"gst_rate\":18}]}")
POID=$(extract "$PO" "id"); PONO=$(extract "$PO" "po_number")
echo "  created PO $PONO ($POID)"
expect_task submit purchase purchase_order "$POID"

# 4.1 Submit → checker approval task
req POST "/goods-purchase-orders/$POID/submit" "{}" > /dev/null
expect_task approve checker purchase_order "$POID"

# 4.2 Checker approves (auto-send) → receive-goods task
req POST "/goods-purchase-orders/$POID/approve" "{}" > /dev/null
expect_task await_goods warehouse purchase_order "$POID"
expect_no_task approve checker purchase_order "$POID"

# 4.3 Create GRN draft → confirm task
GRN=$(req POST /goods-receipts "{\"goods_purchase_order_id\":\"$POID\",\"lines\":[{\"sku\":\"GAD-X\",\"name\":\"Gadget X\",\"ordered_qty\":20,\"received_qty\":20,\"accepted_qty\":20,\"rejected_qty\":0,\"unit_cost\":50}]}")
GRNID=$(extract "$GRN" "id")
echo "  created GRN ($GRNID)"
expect_task confirm warehouse grn "$GRNID"

# 4.4 Confirm GRN → fully received: receive task closes; finance gets record-supplier-invoice
req POST "/goods-receipts/$GRNID/confirm" "{}" > /dev/null
expect_task record_supplier_invoice finance purchase_order "$POID"
expect_no_task await_goods warehouse purchase_order "$POID"
expect_no_task confirm warehouse grn "$GRNID"

# 4.5 Record supplier invoice (linked to PO) → verify task (finance); PO task closes
PI=$(req POST /purchase-invoices "{\"vendor_id\":\"$SID\",\"invoice_number\":\"SUP-$PONO\",\"amount\":1180,\"goods_purchase_order_id\":\"$POID\"}")
PIID=$(extract "$PI" "id")
echo "  created PI SUP-$PONO ($PIID)"
expect_task verify finance purchase_invoice "$PIID"
expect_no_task record_supplier_invoice finance purchase_order "$POID"

# 4.6 Submit PI → checker approval task
req POST "/purchase-invoices/$PIID/submit" "{}" > /dev/null
expect_task approve_for_payment checker purchase_invoice "$PIID"

# 4.7 Checker approves → treasury records payment
curl -s -m 20 -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"status":"approved"}' "$BASE/purchase-invoices/$PIID" > /dev/null
expect_task record_payment treasury purchase_invoice "$PIID"
expect_no_task approve_for_payment checker purchase_invoice "$PIID"

# 4.8 Mark paid → PI leaves the queue
curl -s -m 20 -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"status":"paid","paid_date":"2026-09-24","paid_amount":1180}' "$BASE/purchase-invoices/$PIID" > /dev/null
expect_no_task record_payment treasury purchase_invoice "$PIID"

echo "════ 5. One-modal PO + proforma → both tasks open ════"
PO2=$(req POST /goods-purchase-orders "{\"supplier_id\":\"$SID\",\"payment_terms\":\"Net 30\",\"lines\":[{\"name\":\"Gadget Y\",\"sku\":\"GAD-Y\",\"ordered_qty\":8,\"unit_price\":25,\"gst_rate\":0}],\"also_create\":\"proforma\"}")
POID2=$(extract "$PO2" "id"); PONO2=$(extract "$PO2" "po_number")
CREATEDPF=$(extract "$PO2" "created_proforma.id")
echo "  created PO $PONO2 + proforma $CREATEDPF"
expect_task submit purchase purchase_order "$POID2"
expect_task approve checker proforma "$CREATEDPF"

echo "════ 6. Rejections loop back to the maker ════"
# 6.1 SO checker rejection → back to draft submit task
SO3=$(req POST /goods-sales-orders "{\"customer_id\":\"$CID\",\"payment_terms\":\"Net 30\",\"lines\":[{\"name\":\"Widget C\",\"sku\":\"WID-C\",\"ordered_qty\":3,\"unit_price\":10,\"gst_rate\":0}]}")
SOID3=$(extract "$SO3" "id")
req POST "/goods-sales-orders/$SOID3/submit" "{}" > /dev/null
req POST "/goods-sales-orders/$SOID3/warehouse-approve" "{}" > /dev/null
req POST "/goods-sales-orders/$SOID3/reject" "{\"comments\":\"price too low\"}" > /dev/null
expect_task submit sales sales_order "$SOID3"

# 6.2 PO checker rejection → back to draft submit task
PO3=$(req POST /goods-purchase-orders "{\"supplier_id\":\"$SID\",\"payment_terms\":\"Net 30\",\"lines\":[{\"name\":\"Gadget Z\",\"sku\":\"GAD-Z\",\"ordered_qty\":2,\"unit_price\":30,\"gst_rate\":0}]}")
POID3=$(extract "$PO3" "id")
req POST "/goods-purchase-orders/$POID3/submit" "{}" > /dev/null
req POST "/goods-purchase-orders/$POID3/reject" "{\"comments\":\"wrong supplier\"}" > /dev/null
expect_task submit purchase purchase_order "$POID3"

echo "════ 7. Backfill rebuild mirrors live rules ════"
BF=$(req POST /workflow-tasks/backfill "{}")
echo "  backfill: $BF"

echo ""
echo "════ SUMMARY ════"
echo "  PASS: $PASS   FAIL: $FAIL"
[ "$FAIL" -eq 0 ] && echo "  🎉 All My Queue automation checks passed" || echo "  ⚠️  Some checks failed — see ❌ above"
