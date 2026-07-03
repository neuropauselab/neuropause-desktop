# Enterprise Search

> One search across everything. Source:
> `apps/desktop/src/renderer/src/enterprise/EnterpriseSearchPanel.tsx`.

A single box that fans out across the organization and merges the results.

## Two layers

1. **Federated retrieval** — `ipc.search.enterprise({ text })` queries the
   Unified Data Model (records: projects, tasks, documents, conversations,
   calendar events, customers, …), the **Knowledge Graph**, AI Memory, and the
   Enterprise Timeline, each scored and grouped per source. This is the Phase 5
   federated search, unchanged.
2. **Organization-local** — the panel also filters the live enterprise data the
   provider already holds, to cover the org-specific things that are not UDM
   records:
   - **AI Workers** — by name / role
   - **Policies** — compliance rules + approval chains
   - **Approvals** — pending proposals by title / summary
   - **People & Customers** — org members + customer graph nodes

## Controls

Source toggle chips switch each group (Records, Graph, Memory, Timeline · Workers,
Policies, Approvals, People) on or off. Results render grouped by source, each hit
with its kind, snippet, timestamp, and a relevance bar. The Command Center search
bar deep-links here with the query pre-filled.

## Data source

The Unified Data Model and the Enterprise Knowledge Graph, exactly as the
deliverable requires — supplemented (not replaced) by the organization's own
workers, policies, approvals, and people so the one box truly covers the whole
organization.
