# NeuroPause — Bringing Your Existing Data In

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: business users, evaluators
>
> **Status: NOT YET AVAILABLE IN THE APP.** The import engine is built and tested, but there is no screen for it yet — see "Where this stands" at the end. This page describes how it works so you can evaluate the approach; it does not describe a button you can press today.

## The idea

You should not have to learn NeuroPause's database before you can use NeuroPause. Give it the spreadsheet you already have, and it works out what's in there: which sheet holds customers, which holds invoices, which column is the invoice total. You review what it found, approve it, and the data lands in the right business module.

## What it can read

Spreadsheets (`.xlsx`), CSV and TSV files, JSON, XML, Word documents (`.docx`) and plain text. It reads real workbooks properly — multiple sheets, shared text, and dates (a date in Excel is stored as a number; it converts them back).

**What it cannot read:** PDFs and scanned images. Rather than guess, it says so plainly — "PDF text extraction is not implemented in this build" or "OCR is not configured". A file it cannot read is never silently treated as empty.

## How it decides where things go

It never decides on a column heading alone. For each column it looks at the heading *and* the actual values, and the two must agree:

- A column headed **"Invoice Date"** that contains people's names is **not** treated as a date. The mismatch lowers the confidence rather than producing a confident mistake.
- A column headed **"Annual Salary"** is **not** put into a monthly salary field. That would be a twelve-times error on someone's pay.
- A column headed **"Payment Terms"** containing `NET30` is left alone rather than forced into a tax-number field just because it looks like a code.

Everything it proposes comes with a confidence — **high**, **medium** or **low** — and the reasoning behind it, for example: *"header 'Customer Name' matches 'customer name'"*, *"values look like email (100% of sampled rows)"*. You can see why it thinks what it thinks.

## What it checks before anything is saved

For every row it reports whether the row is **valid**, **invalid** (a value that cannot be used, like the word "pending" in an amount column), **incomplete** (a required field is missing), or a **duplicate**.

Duplicates are found intelligently — "ABC Industries Pvt Ltd" and "ABC Industries Private Limited" are recognised as the same company. **Duplicates are shown to you, never merged automatically.** Merging customer records is not something software should do behind your back.

It also tidies values as it goes and tells you exactly what it changed — `"₹25,000" → 25000 INR`, `15/03/2026 → 2026-03-15`.

## The import plan

Before anything is written you get a plan: what was found, where each part would go, how confident it is, and what's wrong with the data. For example:

| Found | Going to | Rows | Confidence |
|---|---|---:|---|
| Customers | CRM → Customers | 1,248 | high |
| Employees | HR → Employees | 342 | high |
| Invoices | Finance → Invoices | 8,421 | high |
| Projects | Projects | 32 | high |

Nothing is saved at this stage.

## Approval, and why some things always need it

Low-risk data can be imported once you say go. **Anything touching money, payroll, or your customer, supplier and employee master records always requires your explicit approval** — and so does anything the system was less than fully confident about. Those never import quietly.

If something goes wrong partway through a high-risk import, the whole table is undone rather than left half-loaded. You are told exactly what happened: how many were imported, skipped, and failed. An import where anything failed is never reported as a success.

## Tracing anything back

Every imported record remembers where it came from — the file, the sheet, the row, the original value, and what was changed:

> `Finance · Invoice · Total` ← `company.xlsx` → sheet `Invoices` → row 1847 → column "Invoice Amount" → `"₹25,000"` normalized to `25000 INR` → approved by you → imported 8 Aug 2026

## Where this stands

The engine described here is **built and tested** — 63 automated tests cover real spreadsheet parsing, the classification safeguards, validation, duplicate detection, the approval gate, rollback and provenance. What does **not** exist yet is the screen to use it: the drag-and-drop area, the review table, and the approve button.

So: the thinking is real and verifiable, the interface is not built. It is listed honestly as not-yet-available rather than shown as a feature you can try.

## Related
[Enterprise Data Plane (developer)](../developer/ENTERPRISE-DATA-PLANE.md) · [User Guide](NEUROPAUSE-USER-GUIDE.md) · [Knowledge Guide](KNOWLEDGE-GUIDE.md)
