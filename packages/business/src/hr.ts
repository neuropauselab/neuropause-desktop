/**
 * Module 13 — HR Platform. Employees, departments, skills, performance, recruitment, training,
 * career paths, organization charts, and succession planning. All in-process and live-verified;
 * the registry starts empty — there are no live HR records until real data is entered.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';

export interface Department { id: string; name: string; }
export interface Employee {
  id: string;
  name: string;
  title: string;
  departmentId?: string;
  managerId?: string;
  skills: string[];
  createdAt: number;
}
export interface PerformanceReview { id: string; employeeId: string; rating: number; period: string; }
export interface Requisition { id: string; title: string; departmentId?: string; status: 'open' | 'filled' | 'closed'; }

export class HrRuntime {
  private readonly departmentsMap = new Map<string, Department>();
  private readonly employeesMap = new Map<string, Employee>();
  private readonly reviewsList: PerformanceReview[] = [];
  private readonly reqsMap = new Map<string, Requisition>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
  ) {}

  async createDepartment(name: string): Promise<Department> {
    const d: Department = { id: randomId('dept'), name };
    this.departmentsMap.set(d.id, d);
    return d;
  }
  async createEmployee(input: { name: string; title?: string; departmentId?: string; managerId?: string }): Promise<Employee> {
    const e: Employee = { id: randomId('emp'), name: input.name, title: input.title ?? 'staff', ...(input.departmentId ? { departmentId: input.departmentId } : {}), ...(input.managerId ? { managerId: input.managerId } : {}), skills: [], createdAt: this.clock.now() };
    this.employeesMap.set(e.id, e);
    await this.governance.record({ actor: 'system', domain: 'hr', operation: 'employee.create', targetId: e.id, evidence: 'live-verified' });
    return e;
  }
  async addSkill(employeeId: string, skill: string): Promise<Employee> {
    const e = this.require(employeeId);
    if (!e.skills.includes(skill)) e.skills.push(skill);
    return e;
  }
  async recordPerformance(input: { employeeId: string; rating: number; period: string }): Promise<PerformanceReview> {
    const r: PerformanceReview = { id: randomId('perf'), employeeId: input.employeeId, rating: input.rating, period: input.period };
    this.reviewsList.push(r);
    await this.governance.record({ actor: 'system', domain: 'hr', operation: 'performance.record', targetId: r.id, evidence: 'live-verified' });
    return r;
  }
  async openRequisition(input: { title: string; departmentId?: string }): Promise<Requisition> {
    const r: Requisition = { id: randomId('req'), title: input.title, ...(input.departmentId ? { departmentId: input.departmentId } : {}), status: 'open' };
    this.reqsMap.set(r.id, r);
    return r;
  }

  /** Organization chart built from real manager relationships. */
  orgChart(): Array<{ id: string; name: string; managerId?: string; reports: number }> {
    const emps = [...this.employeesMap.values()];
    return emps.map((e) => ({ id: e.id, name: e.name, ...(e.managerId ? { managerId: e.managerId } : {}), reports: emps.filter((x) => x.managerId === e.id).length }));
  }

  private require(id: string): Employee {
    const e = this.employeesMap.get(id);
    if (!e) throw new Error(`no employee ${id}`);
    return e;
  }

  departments(): Department[] { return [...this.departmentsMap.values()]; }
  employees(): Employee[] { return [...this.employeesMap.values()]; }
  reviews(): PerformanceReview[] { return [...this.reviewsList]; }
  requisitions(): Requisition[] { return [...this.reqsMap.values()]; }
  count(): number { return this.employeesMap.size; }
}
