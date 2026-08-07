# Inventory & Procurement — Getting Started

**For pilot users · v1.0.0-rc.14 lineage.** Two families, one flow: what you stock and how you buy it.

## 1. Products and stock

**Inventory → Products**: SKU, name, costs, and the replenishment policy — reorder level, safety stock, maximum stock, and **Auto Reorder** (off by default). Stock figures are read-only and derived from the immutable **Stock Movements** ledger — receipts, issues, transfers; corrections are compensating movements, never edits.

## 2. Buying

**Procurement → Suppliers** first. Then either draft a **Purchase Request** (or let auto-reorder draft one when a product's position — available + on order — hits its reorder level), approve it, and **Create Purchase Order**; or raise the PO directly. At PO **approval**, two optional gates run with real teeth: a named Finance **budget** (off/warn/block on committed spend) and a named **Vendor Contract** (must be active, in its validity window, and for that supplier — dangling or expired references refuse loudly).

## 3. Receiving

**Receive Goods** on the PO raises a **Goods Receipt**; posting it writes the receive movement into the stock ledger, which re-derives the product's on-hand figures and — if the product opted in — quiets or triggers the next replenishment cycle. **Vendor Bills** and payments settle the money side; **Supplier Performance** scores suppliers from receipt evidence.

## Watch the dashboard

Inventory's dashboard lists products at/below their own reorder levels; Procurement's shows the PO pipeline and contracts expiring within 60 days. All from live records.
