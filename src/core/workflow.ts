import type { Department, Employee, Report, ReportEvent, Settings } from "./model.ts";
import type { Ore } from "./money.ts";

// Report lifecycle, mirroring Kvitto & Resa:
//   draft -> submitted -> approved -> exported
//                     \-> rejected -> (edit) -> submitted
// Approvers are resolved like "Min organisation": a specific approver on the
// employee, else the department's approvers, else the company default approver.
// Approval limits and the number of required approvals come from settings.

export class WorkflowError extends Error {}

export interface Organisation {
  employees: Employee[];
  departments: Department[];
  settings: Settings;
}

export function isEditable(report: Report): boolean {
  return report.status === "draft" || report.status === "rejected";
}

export function resolveApprovers(employee: Employee, org: Organisation): Employee[] {
  const byId = (id: string) => org.employees.find((e) => e.id === id);
  let ids: string[];
  if (employee.approverId) {
    ids = [employee.approverId];
  } else {
    const department = org.departments.find((d) => d.id === employee.departmentId);
    ids = department && department.approverIds.length > 0 ? department.approverIds : org.settings.approval.defaultApproverId ? [org.settings.approval.defaultApproverId] : [];
  }
  const approvers = ids.map(byId).filter((e): e is Employee => !!e && e.id !== employee.id);
  // Administrators can always approve, which keeps reports from getting stuck when nobody is configured.
  const admins = org.employees.filter((e) => e.role === "admin" && e.id !== employee.id && !approvers.includes(e));
  return [...approvers, ...admins];
}

export function canApprove(report: Report, user: Employee, total: Ore, org: Organisation): boolean {
  if (report.status !== "submitted" || user.id === report.employeeId) return false;
  if (report.approvals.some((a) => a.by === user.id)) return false;
  const owner = org.employees.find((e) => e.id === report.employeeId);
  if (!owner || !resolveApprovers(owner, org).some((e) => e.id === user.id)) return false;
  return user.approvalLimit === undefined || total <= user.approvalLimit;
}

function event(report: Report, by: string, action: ReportEvent["action"], comment?: string): void {
  report.history.push({ at: new Date().toISOString(), by, action, ...(comment ? { comment } : {}) });
}

export function submit(report: Report, user: Employee): void {
  if (user.id !== report.employeeId) throw new WorkflowError("Endast rapportens ägare kan skicka in den");
  if (!isEditable(report)) throw new WorkflowError("Rapporten är redan inskickad");
  if (report.entries.length === 0) throw new WorkflowError("Rapporten är tom");
  report.status = "submitted";
  report.submittedAt = new Date().toISOString();
  report.approvals = [];
  event(report, user.id, "submitted");
}

export function approve(report: Report, user: Employee, total: Ore, org: Organisation): void {
  if (!canApprove(report, user, total, org)) throw new WorkflowError("Du kan inte attestera den här rapporten");
  report.approvals.push({ by: user.id, at: new Date().toISOString() });
  event(report, user.id, "approved");
  if (report.approvals.length >= Math.max(1, org.settings.approval.requiredApprovals)) report.status = "approved";
}

export function reject(report: Report, user: Employee, total: Ore, org: Organisation, comment: string): void {
  if (!canApprove(report, user, total, org)) throw new WorkflowError("Du kan inte neka den här rapporten");
  if (!comment.trim()) throw new WorkflowError("Ange en kommentar till den anställde");
  report.status = "rejected";
  report.approvals = [];
  event(report, user.id, "rejected", comment);
}

export function markExported(report: Report, user: Employee, details: NonNullable<Report["export"]>): void {
  if (report.status !== "approved") throw new WorkflowError("Endast attesterade rapporter kan överföras");
  if (user.role !== "admin") throw new WorkflowError("Endast administratörer kan överföra till Fortnox");
  report.status = "exported";
  report.export = details;
  event(report, user.id, "exported");
}
