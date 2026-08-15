# DEFECTS FOUND IN FROZEN `@neuropause/cst 1.3.0` — RAT-14 change-request candidates

**Found during Desktop integration (Phase C), 2026-08-15. NOT edited.**
Per NP-USE-01 §4 / USE-14: the baseline is frozen; finding a defect does not
authorise an edit. These are written down, classified, and recorded here as
CHANGE REQUEST candidates under NP-RAT-01 RAT-14. The frozen package was **not**
modified (hash `293d0560…ceb431` intact). The Desktop consumes the package
without editing it (see how, below).

## D-CST-A — `package.json main` does not resolve  ·  classification: **material**
- **What:** `package.json` declares `"main": "dist/index.js"` and
  `"types": "dist/index.d.ts"`, but the built output is under `dist/src/` — there
  is no `dist/index.js` / `dist/index.d.ts`. `require('@neuropause/cst')` /
  `import '@neuropause/cst'` fail to resolve the entry.
- **Where:** `neuropause-cst-1.3.0.tgz` → `package/package.json` (`main`, `types`).
- **Evidence:** `ls node_modules/@neuropause/cst/dist/index.js` → No such file;
  real entry is `dist/src/index.js`.
- **Why material:** the package's advertised entry point is unimportable as
  published; every consumer must know the internal `dist/src/` layout.

## D-CST-B — barrel `index.js` hard-imports a Node ≥22 builtin  ·  classification: **material (environment)**
- **What:** the barrel `dist/src/index.js` re-exports `durable.js`, which does
  `import { DatabaseSync } from 'node:sqlite'`. `node:sqlite` is an experimental
  builtin only in Node ≥22, so importing the barrel throws
  `ERR_UNKNOWN_BUILTIN_MODULE` on Node 20 (this host; the Desktop toolchain).
- **Where:** `dist/src/index.js` → `dist/src/durable.js:20`.
- **Evidence:** loading `dist/src/index.js` throws `ERR_UNKNOWN_BUILTIN_MODULE`;
  loading `kernel.js` + `stores.js` + `types.js` directly loads cleanly (CstKernel
  present, 18 guards, all in-memory stores) under Node 20.
- **Why material:** the kernel + in-memory stores (the parts a consumer needs to
  run `CstKernel.run`) do not depend on `node:sqlite`, but the barrel couples
  them to the durable SQLite store, forcing Node ≥22 on any consumer that imports
  the package's advertised entry — even one using only the in-memory stores.

## How the Desktop consumes the package WITHOUT editing it
The adapter imports the specific submodules that load under Node 20 and avoid the
broken barrel/entry:
```ts
import { CstKernel } from '@neuropause/cst/dist/src/kernel.js';
import { ClaimStore, IdempotencyStore, ResourceStore, EvidenceStore, SystemTime } from '@neuropause/cst/dist/src/stores.js';
import { transitionId, requestId, idempotencyKey, approvalId } from '@neuropause/cst/dist/src/types.js';
```
This is *consumption*, not modification — the frozen bytes are untouched. It also
means the Desktop uses the **in-memory** ClaimStore/IdempotencyStore (a declared
durability gap, mirroring source `O-6`), not the SQLite `durable.js`.

**Disposition:** recorded, awaiting RAT-14 decision. No edit performed.
