/**
 * Lead Conversion — the single deterministic "Convert Lead → Contact → Customer"
 * transaction that powers the CRM stage of the ERP flow
 * (Lead → Contact → Customer → Quote → Order → Invoice → Payment).
 *
 * From one Lead it creates a Contact and a Customer, cross-links all three
 * (the new records carry `sourceLead`/`sourceContact`; the lead is stamped with
 * `convertedContact`/`convertedCustomer`), and emits each record's lifecycle so
 * the whole chain is audited and shows on the Timeline. It is:
 *   • idempotent — a lead already converted is a no-op (never duplicates records);
 *   • non-destructive — the lead is RETAINED (marked converted), never deleted,
 *     so audit history is preserved.
 *
 * Pure orchestration over the framework via the injected action context (it owns
 * no persistence of its own), so it unit-tests with in-memory modules.
 */
import type { EnterpriseEntity, EnterpriseModuleActionResult } from '@neuropause/shared';
import {
  CRM_MODULE_ID,
  CUSTOMERS_MODULE_ID,
  LEADS_MODULE_ID,
  deriveRecordTitle,
  leadFromRecord,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

/** The descriptor action key the Leads module surfaces for conversion. */
export const CONVERT_ACTION = 'convert';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Validate + create a record in a target module, then fan out its lifecycle. */
function createLinked(
  module: EnterpriseModule,
  fields: Record<string, string | number | boolean | null>,
  ctx: EnterpriseModuleActionContext,
): EnterpriseEntity | { error: string } {
  const validation = module.hooks.validate({ fields });
  if (!validation.ok) {
    const first = Object.values(validation.errors)[0] ?? 'invalid input';
    return { error: `${module.descriptor.singular}: ${first}` };
  }
  const record = module.store.create({
    title: deriveRecordTitle(module.descriptor, validation.values),
    fields: validation.values,
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(module, 'created', record);
  return record;
}

/**
 * Convert a Lead into a Contact + a Customer. Resolves the target modules from
 * the action context, so no module is imported here (no cross-module cycles).
 */
export async function convertLeadToCustomer(
  lead: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  // Already converted → no-op. Never create a second contact/customer.
  if (str(lead.fields.convertedCustomer) || str(lead.fields.convertedContact)) {
    return { ok: false, message: 'This lead has already been converted.' };
  }

  const contactsModule = ctx.moduleFor(CRM_MODULE_ID);
  const customersModule = ctx.moduleFor(CUSTOMERS_MODULE_ID);
  const leadsModule = ctx.moduleFor(LEADS_MODULE_ID);
  if (!contactsModule || !customersModule || !leadsModule) {
    return { ok: false, error: 'CRM modules are not all available for conversion.' };
  }

  // Assert the actor may write both targets (they share crm:manage with Leads,
  // already authorized by the action handler — this future-proofs a scope change).
  ctx.authorize(contactsModule.descriptor.permissions.write);
  ctx.authorize(customersModule.descriptor.permissions.write);

  await Promise.all([contactsModule.store.load(), customersModule.store.load()]);

  const ld = leadFromRecord(lead);
  const person = ld.contactPerson || ld.name;
  const account = ld.company || ld.name;
  const phone = str(lead.fields.phone);
  const industry = str(lead.fields.industry);

  // 1) Contact — the person, cross-linked back to the originating lead.
  const contact = createLinked(
    contactsModule,
    {
      name: person,
      company: ld.company,
      email: ld.email,
      phone,
      status: 'customer',
      priority: ld.priority || 'medium',
      assignedTo: ld.assignedTo,
      source: ld.source,
      industry,
      sourceLead: lead.id,
    },
    ctx,
  );
  if ('error' in contact) return { ok: false, error: contact.error };

  // 2) Customer — the account, cross-linked to both the lead and the new contact.
  const customer = createLinked(
    customersModule,
    {
      name: account,
      company: ld.company,
      primaryContact: person,
      email: ld.email,
      phone,
      status: 'onboarding',
      customerTier: 'standard',
      accountManager: ld.assignedTo,
      industry,
      lifetimeRevenue: 0,
      sourceLead: lead.id,
      sourceContact: contact.id,
    },
    ctx,
  );
  if ('error' in customer) return { ok: false, error: customer.error };

  // 3) Retain + cross-link the lead (never delete), then emit `converted` so the
  //    conversion is audited and lands on the Timeline. Stamps only cross-ref
  //    fields, so the deterministic leadScore is untouched.
  const updatedLead = leadsModule.store.update(lead.id, {
    fields: { convertedContact: contact.id, convertedCustomer: customer.id },
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(leadsModule, 'converted', updatedLead ?? lead);

  return {
    ok: true,
    message: `Converted to customer "${customer.title}" and contact "${contact.title}".`,
  };
}
