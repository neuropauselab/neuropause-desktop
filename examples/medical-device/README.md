# SYNTHETIC TEST DATA — Medical Device Manufacturing Pack

**Every row in this folder is invented.** These files exist so the Medical
Device pack can be exercised end to end — import, review, mapping, relationship
resolution, provenance, and a forward and backward trace — without anyone
needing real production data to try it.

Nothing here came from, describes, or is derived from any real manufacturer,
customer, supplier, product or batch. Every product code is prefixed `SYN-`,
every product name begins with the word `SYNTHETIC`, and every lot, shipment,
customer, supplier and order reference is prefixed `SYN-`. That prefixing is
deliberate: if one of these files is ever imported into a workspace that also
holds real records, the invented ones are identifiable at a glance and can be
filtered out, rather than quietly becoming part of a traceability answer.

The dimensions, materials and family names are drawn from ordinary orthopaedic
vocabulary so the data *reads* plausibly. Plausible is all it is. **No row here
describes a device that exists, and nothing in it should be read as a claim
about any product's design, approval, performance or safety.**

## Files

| File | Rows | Imports as |
|---|---|---|
| `synthetic-products.csv` | 94 | Medical Device Product (`md-products`) |
| `synthetic-lots.csv` | 302 | Batch / Lot (`md-lots`) |
| `synthetic-shipments.csv` | 161 | *No destination module in this build* |

`synthetic-shipments.csv` is included because shipment-to-customer links are
half of the forward trace, and it is honest to ship the data that demonstrates
it. There is no shipment module in this build, so the Data Command Center will
not offer a destination for it; the shipment links in the traceability graph are
created by recording a shipment on a lot in the Batch/Lot Center, or by the
`md:lot.ship` channel. The file is here so that path can be driven with
consistent references.

## How to use it

1. **Products first.** Open **Data**, drop `synthetic-products.csv`, review the
   proposed mapping and import. Medical device products are medium-risk, so the
   import will ask you to look at the mapping but will not demand a separate
   approval step.
2. **Then lots.** Drop `synthetic-lots.csv`. Batches are **high-risk** — a lot
   is the unit a recall is executed in — so this import requires an explicit
   approval before anything is written. That is the intended friction.
3. Import order does not actually matter. A lot whose product has not arrived
   yet parks in **Data → Relationships** and links itself when the product is
   imported.
4. Open **Medical Devices → Batch / Lot**, pick a released lot, press **Trace**.

## What the data is shaped to exercise

- **Lot status variety.** Released, quarantined and blocked lots, so the Lot
  Center views and the "material cannot be drawn from this" refusals are all
  reachable.
- **Lots with and without expiry.** Most non-sterile articles carry no expiry
  date at all, because that is the common real case and the surface must not
  read an empty expiry as a hazard.
- **Raw material lots in kilograms, finished goods in pieces.** Mixed units,
  including fractional raw-material quantities, which is where naive quantity
  arithmetic leaves an invisible residue.
- **Manufacturing order references** on finished goods lots, so the backward
  trace has an order to walk through.
- **Unresolvable references.** Supplier and warehouse codes that have no
  matching record until you create one — so the relationship review queue has
  something real in it, and you can watch a parked reference link itself.
