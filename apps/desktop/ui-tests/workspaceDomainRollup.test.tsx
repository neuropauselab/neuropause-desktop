/**
 * FG-8 · L1 Workspace Foundation domain rollup — truthful-surface tests.
 * Every displayed value derives from the snapshot; an UNAVAILABLE module reads
 * "unavailable", never a fabricated "0"; absent → nothing; local mode shows the
 * local tenant's rollup with honest UNAVAILABLE modules.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ExecutiveSnapshot } from '@neuropause/shared';
import { WorkspaceDomainRollup } from '@renderer/enterprise/WorkspaceDomainRollup';

type Domain = ExecutiveSnapshot['workspaceDomain'];
const domain = (slices: NonNullable<Domain>['slices'], scopeResolved = true): Domain => ({ scopeResolved, slices });
const slice = (o: Partial<NonNullable<Domain>['slices'][number]>): NonNullable<Domain>['slices'][number] => ({
  domain: 'people', moduleId: 'hr-employees', label: 'People', count: 0, state: 'present', ...o,
});

afterEach(() => cleanup());

describe('WorkspaceDomainRollup (FG-8 truthful surface)', () => {
  it('STATE FIDELITY — a present domain shows its count; an UNAVAILABLE domain reads "unavailable", never "0"', () => {
    render(
      <WorkspaceDomainRollup
        domain={domain([
          slice({ moduleId: 'hr-employees', label: 'People', count: 3, state: 'present' }),
          slice({ moduleId: 'crm-customers', label: 'Customers', count: 0, state: 'unavailable' }),
        ])}
      />,
    );
    expect(screen.getByText('People').parentElement?.textContent).toContain('3');
    // The unavailable domain shows the STATE, not a fabricated "0 customers".
    const customers = screen.getByText('Customers').parentElement;
    expect(customers?.textContent).toContain('unavailable');
    expect(customers?.textContent).not.toMatch(/\b0\b/);
  });

  it('FALLBACK — absent or unresolved workspaceDomain renders NOTHING (never fabricates)', () => {
    const { container: c1 } = render(<WorkspaceDomainRollup domain={undefined} />);
    expect(c1.querySelector('[aria-label="Workspace domain"]')).toBeNull();
    cleanup();
    const { container: c2 } = render(<WorkspaceDomainRollup domain={domain([slice({})], false)} />);
    expect(c2.querySelector('[aria-label="Workspace domain"]')).toBeNull();
  });

  it('LOCAL-MODE SURFACE — the local tenant rollup: present local counts + honest UNAVAILABLE modules', () => {
    // In local mode the snapshot resolves to the local tenant; the surface shows it faithfully.
    render(
      <WorkspaceDomainRollup
        domain={domain([
          slice({ moduleId: 'hr-employees', label: 'People', count: 1, state: 'present' }),
          slice({ moduleId: 'projects', label: 'Projects', count: 0, state: 'unavailable' }),
        ])}
      />,
    );
    expect(screen.getByText('People').parentElement?.textContent).toContain('1'); // the local tenant's real record
    expect(screen.getByText('Projects').parentElement?.textContent).toContain('unavailable'); // no local store → honest
  });
});
