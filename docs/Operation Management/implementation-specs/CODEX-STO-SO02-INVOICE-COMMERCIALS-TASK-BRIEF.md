# Codex Task Brief — STO Commercial Resolution in SO02 Invoice Preparation

**Status:** PENDING — proposal captured on 2026-09-11; no implementation has been done from this brief  
**Business scope:** Sending-company workflow only  
**Pages:** STO create/detail, SO03 Delivery Order, SO02 Invoice Preparation and invoice preview  
**Source scope:** New and Legacy STO; Independent and Distribution STO  

---

## 1. Business decision

An STO creator must enter the transfer rate and Freight Term because these are transfer-order facts. The STO creator must not enter item GST Rate or decide whether item GST is Inclusive or Exclusive. The selling/accounts user will resolve item GST in SO02 Invoice Preparation.

The final ownership is:

| Commercial value | Authority / source |
|---|---|
| Material transfer Rate | STO |
| Currency | STO |
| Payment Term | STO; preserve the current behavior |
| Freight Term | STO |
| Item GST Rate | SO02 Invoice Preparation, STO groups only |
| Item GST Inclusive / Exclusive | SO02 Invoice Preparation, STO groups only |
| CGST / SGST / IGST split | System, from sending and receiving states |
| Freight amount and settlement | SO02, controlled by the STO Freight Term |
| Freight tax treatment | SO02 when freight is chargeable in the invoice |

This change must not alter Sales Order invoice-group behavior.

---

## 2. Confirmed current gaps

The production examples reviewed on 2026-09-11 showed these gaps:

1. STO invoice preparation displayed item GST as `0.00%` because STO/DO supplied no usable final GST decision and SO02 currently treats the DO-line GST snapshot as final.
2. The SO02 Delivery Order queue displayed Customer / Counterparty as `—` for STO rows. A unified DO stores source ownership in `delivery_challan_source` and line source references; the list response was relying on the nullable legacy DO header `receiving_company_id` instead of resolving the receiving company through the STO source.
3. STO rows displayed Dispatch Category as `—` because the current list calculation derives it only from Sales Order data.
4. STO invoice groups currently do not receive a usable `freight_term`, even though the STO lines hold it. Therefore the existing freight controls do not open for STO groups.
5. A mixed-source DO can contain both SO and STO sources. Commercial resolution must operate per invoice group and must not apply STO rules to SO groups.

The checked production examples were:

- DO `9100000261` → STO `JI/PO36/2026-27`, receiving company CMP011 — JAYASHREE INDUSTRIES.
- DO `9100000260` → STO `ACP/PO87/2026-27`, receiving company CMP005 — ALMEGA COATINGS PRIVATE LIMITED.

---

## 3. STO create and detail changes

### Keep on STO

- Material
- Quantity and UOM
- Transfer Rate
- Currency
- Payment Term
- Freight Term
- Existing dates, company, cost-center, STO type and delivery-type fields

### Remove from STO commercial input

- Item GST Rate
- Item GST Inclusive / Exclusive

The same rule applies to New STO and Legacy STO. It also applies to both Independent and Distribution STOs.

STO detail may show final invoice tax after an invoice exists, but must label it as invoice-derived information. It must not present invoice tax as an STO-entered value.

### Freight Term consistency

Freight is calculated at invoice-group level. Therefore every line in one STO must resolve to one Freight Term. The create/update API must reject an STO whose lines contain conflicting Freight Terms. Existing data with conflicting terms must be detected and handled before enabling invoice preparation; it must not silently pick the first line's value.

---

## 4. SO03 Delivery Order behavior

For an STO source, SO03 must carry the STO material Rate, Currency, Payment Term and Freight Term into the unified delivery data used by SO02.

SO03 must not finalize item GST for an STO. Existing zero-valued STO GST snapshots must be treated as **unresolved**, not as a user decision for 0% GST. Sales Order source lines retain their current GST behavior.

A mixed DO may contain SO and STO lines. Source links must remain the authority, and the invoice preparation endpoint must group and calculate each source type separately.

The sending company owns DO creation, invoice creation and stock OUT posting. Receiving-location Gate Entry, GRN, receipt and PACE processing are outside this task; those records will be backfilled when the receiving locations adopt PACE.

---

## 5. SO02 queue corrections for STO

For STO rows in the Select Delivery Order screen:

- **Customer / Counterparty:** receiving company resolved from the linked STO.
- **Type:** `STO`.
- **Dispatch Category:** derive from the STO line material composition:
  - RM, PM or INT → `RPS`
  - FG only → `FRPS`
  - SFG only → `SRPS`
  - FG and SFG together → `FSRPS`

Resolution must use the unified source tables and line references. It must not depend on nullable legacy singular source columns on the DO header.

---

## 6. Invoice-group isolation

Each STO remains its own invoice group. Sales Order groups remain separate. A DO containing both sources therefore shows separate groups such as:

- `SO:<sales-order-id>` — current Sales Order behavior
- `STO:<stock-transfer-order-id>` — the STO-specific behavior in this brief

Bulk actions in an STO group must never change an SO group. Posting one group must retain its exact DO/source-line ownership and must not consume a sibling group's reservations.

---

## 7. STO item GST entry in SO02

The STO invoice group must show the Rate received from the STO as read-only. The user resolves tax in SO02 with:

- GST Treatment: Inclusive or Exclusive
- Total GST Rate
- Apply to all lines
- Apply to selected lines
- Per-line override

This avoids entering the same tax choice manually for 50 or more items while retaining an exception path.

Validation before posting:

- Every STO invoice line must have an explicit final GST Treatment and GST Rate.
- A pre-existing DO-line `0` must not satisfy this validation unless the SO02 user explicitly selects a valid 0% rate/exemption outcome.
- SO invoice lines must continue through their existing path without this new mandatory STO prompt.

### Inclusive calculation

For an inclusive Rate:

```text
Taxable value = Gross line value / (1 + GST rate / 100)
GST amount    = Gross line value - Taxable value
Line total    = Gross line value
```

### Exclusive calculation

For an exclusive Rate:

```text
Taxable value = Rate × Invoice quantity
GST amount    = Taxable value × GST rate / 100
Line total    = Taxable value + GST amount
```

All calculations must use the existing system rounding standard and must reconcile the displayed group total with the posted invoice total.

---

## 8. CGST, SGST and IGST presentation

The user enters the total GST Rate; the user does not manually choose CGST, SGST or IGST. The system determines the split from the sending-company state and receiving-company state.

| State relationship | CGST | SGST | IGST |
|---|---:|---:|---:|
| Same state | Total GST ÷ 2 | Total GST ÷ 2 | 0 |
| Different state | 0 | 0 | Total GST |

SO02 and the invoice preview must display separate Rate and Amount fields/columns for CGST, SGST and IGST. The same separation applies to freight tax when freight is taxable.

Missing or unresolvable company state/GST-address data must block invoice posting with a clear error. The system must not guess the tax type.

---

## 9. Freight rules carried from STO

The STO Freight Term must be visible on the invoice group and must control which freight inputs are available.

| STO Freight Term | SO02 rule |
|---|---|
| `FOR` | Freight is already included in the material Rate. Do not show a separate freight charge, freight tax control or To Pay choice. |
| `FREIGHT_SEPARATE` | Allow the agreed separate freight to be marked To Pay or added to the invoice. When added, accept the agreed freight amount/calculation and a tax method. |
| `FREIGHT_AT_ACTUALS` | Allow To Pay or addition to the invoice. When added, require the actual transporter freight amount; do not calculate an estimated Rate × Net Weight amount as the final value. |
| `EX_TRANSPORTER_GODOWN` | Add only first-mile freight: sending location to the transporter godown. The onward freight from the transporter godown is outside the seller invoice. Require the first-mile freight amount and a tax method. |

`FREIGHT_SEPARATE` and `FREIGHT_AT_ACTUALS` use a broadly similar UI. Their amount semantics and validation remain different: agreed separate freight versus the actual transporter amount.

### Freight tax methods

When freight is added to the invoice, SO02 must provide these methods:

1. **Add to taxable value**  
   Freight is included in the assessable value before item GST is calculated.

2. **Freight taxed separately**  
   Freight remains a separate charge with its own GST Treatment and GST Rate.

3. **No GST on freight**  
   Freight is added to the invoice total without freight tax.

4. **To Pay**  
   Available only for `FREIGHT_SEPARATE` and `FREIGHT_AT_ACTUALS`; no freight amount or freight tax is added to the seller invoice.

When freight is added to taxable value and the group contains multiple GST rates, allocate freight proportionately by item taxable value across the GST-rate buckets. Apply each bucket's own GST rate after allocation. Persist the allocated values so that the preview, posting and reversal reproduce the same totals.

The invoice calculation order is:

```text
Material taxable value
+ freight added to taxable value, if selected
= assessable value
+ item GST on the assessable value
+ separately taxed freight and its GST, if selected
+ non-taxable freight, if selected
= invoice total
```

---

## 10. Posting, preview and reversal

The invoice-posting backend must use the SO02-resolved STO commercial values, not stale DO-line GST snapshots.

Persist per invoice line:

- STO Rate and quantity used
- GST Treatment
- GST Rate
- Taxable value
- CGST Rate and Amount
- SGST Rate and Amount
- IGST Rate and Amount
- Line total
- Any proportionately allocated freight included in taxable value

Persist at invoice/group level:

- Source Freight Term
- To Pay state where applicable
- Freight amount and amount basis
- Freight tax method
- Freight GST Treatment and Rate when separately taxed
- Freight CGST / SGST / IGST values
- Invoice totals

Invoice preview/print must show the receiving company as Buyer/Consignee for an STO, the source STO number, the material Rate, separate tax components and the selected freight treatment.

Reversal must reverse only the exact invoice lines, tax values, freight values, DO reservations and sender stock posting owned by that invoice. The receiving-company workflow remains outside scope.

---

## 11. Expected implementation surfaces

The implementation must trace and update at least these areas; exact supporting files may expand after code inspection:

- `frontend/src/pages/dashboard/procurement/sto/StoCreateFormPage.jsx`
- `frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx`
- `frontend/src/pages/dashboard/procurement/sales/PgiInvoiceGroupsCreatePage.jsx`
- STO and unified DO API handlers
- Invoice-group calculation/posting handlers
- Invoice preview/print rendering
- Focused regression tests for STO commercial resolution and mixed-source DOs

### R-04 database rule

- Do not create a migration for business/operational corrections or rollout data.
- Existing STO/DO GST fields may remain for compatibility but must not be treated as final GST authority for STO invoice lines.
- If durable invoice audit requires a column that does not exist, such as invoice-line GST Treatment or allocated freight, add only the minimum genuine schema/DDL migration required. Record operational backfill separately and run it through MCP per environment.
- Do not add ACL, menu snapshot, ACL version bump or capture work unless implementation introduces a new protected resource. Editing the existing pages does not itself require ACL changes.

---

## 12. Acceptance scenarios

1. Create New Independent STO with Rate and `FOR`; no GST input appears on STO. SO02 requires item GST and shows no separate freight controls.
2. Create Legacy Distribution STO with Rate and `FREIGHT_SEPARATE`; SO02 carries the term and supports To Pay, taxable-value inclusion, separate freight GST or no freight GST.
3. `FREIGHT_AT_ACTUALS` requires an actual freight amount when invoice inclusion is selected.
4. `EX_TRANSPORTER_GODOWN` adds first-mile freight only and does not label it as onward/customer freight.
5. Same-state companies produce separate CGST and SGST values with zero IGST.
6. Different-state companies produce IGST with zero CGST and SGST.
7. A 50-line STO group receives GST through Apply All; selected and per-line overrides work.
8. Multiple item GST slabs plus freight added to taxable value allocate freight proportionately and reconcile to the posted total.
9. A mixed DO containing SO and STO creates independent invoice groups; STO controls never modify the SO group.
10. SO02 queue shows the STO receiving company and the correct RPS/FRPS/SRPS/FSRPS category.
11. Invoice preview and persisted invoice values match exactly.
12. Reversal restores only the relevant sender-side stock and source reservations.
13. Existing Sales Order invoice preparation and posting pass unchanged regression coverage.

---

## 13. Explicit exclusions

- Receiving-location Gate Entry, GRN, receipt and stock-IN workflow
- Backfill into receiving locations that do not yet use PACE
- Changes to Sales Order GST/commercial-entry behavior
- New menu or ACL design unless implementation later adds a new screen/resource
- Production data mutation during implementation without a separate reviewed MCP rollout step

