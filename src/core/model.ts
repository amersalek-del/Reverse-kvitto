import type { Category } from "./categories.ts";
import type { VehicleType } from "./mileage.ts";
import type { Ore } from "./money.ts";
import type { RepresentationKind } from "./representation.ts";
import type { TripInput } from "./traktamente.ts";

export type Role = "employee" | "approver" | "admin";

export interface Employee {
  id: string;
  name: string;
  /** Anställningsnummer in Fortnox Lön. */
  employeeNumber: string;
  email?: string;
  role: Role;
  departmentId?: string;
  /** Specific approver for this employee; overrides department and default approver. */
  approverId?: string;
  /** Highest report total this person may approve; unlimited when absent. */
  approvalLimit?: Ore;
}

export interface Department {
  id: string;
  name: string;
  approverIds: string[];
}

export type PaymentMethod = "private" | "company_card";

export interface Dimensions {
  project?: string;
  costCenter?: string;
}

export interface ReceiptEntry extends Dimensions {
  id: string;
  kind: "receipt";
  date: string;
  merchant: string;
  description: string;
  categoryId: string;
  /** ISO 4217 currency code of the receipt. */
  currency: string;
  /** Amount paid including VAT, in the receipt currency's minor unit. */
  amount: Ore;
  /** SEK per unit of currency; 1 for SEK. */
  exchangeRate: number;
  vatRate: number;
  /** VAT in SEK when it differs from what the rate gives, e.g. mixed rates on one receipt. */
  vatOverride?: Ore;
  payment: PaymentMethod;
  attachmentIds: string[];
  representation?: {
    kind: RepresentationKind;
    attendees: string[];
    purpose: string;
  };
}

export interface MileageEntry extends Dimensions {
  id: string;
  kind: "mileage";
  date: string;
  from: string;
  to: string;
  purpose: string;
  km: number;
  vehicle: VehicleType;
  registrationNumber?: string;
  companyRatePerMil?: Ore;
}

export interface TripEntry extends Dimensions {
  id: string;
  kind: "trip";
  purpose: string;
  destination: string;
  trip: TripInput;
}

export type Entry = ReceiptEntry | MileageEntry | TripEntry;

export type ReportStatus = "draft" | "submitted" | "approved" | "rejected" | "exported";

export interface ReportEvent {
  at: string;
  by: string;
  action: "created" | "submitted" | "approved" | "rejected" | "exported" | "reopened";
  comment?: string;
}

export interface Report {
  id: string;
  employeeId: string;
  title: string;
  status: ReportStatus;
  entries: Entry[];
  approvals: { by: string; at: string }[];
  history: ReportEvent[];
  createdAt: string;
  submittedAt?: string;
  export?: {
    vouchers: { series: string; number?: number }[];
    payrollLines: number;
    at: string;
  };
}

export interface Settings {
  companyName: string;
  organisationNumber: string;
  categories: Category[];
  accounts: {
    /** Credit account for private outlays owed to the employee (BAS 2822 Reseräkningar). */
    employeeLiability: string;
    /** Credit account for company card purchases. */
    companyCard: string;
    inputVat: string;
    perDiemDomesticTaxFree: string;
    perDiemForeignTaxFree: string;
    mileageTaxFree: string;
    mileageTaxable: string;
  };
  voucherSeries: string;
  /** One voucher for the whole report, or one per entry on the entry's date. */
  voucherMode: "per_report" | "per_entry";
  /**
   * Who books the cost of per diem and mileage: Fortnox Lön's salary voucher (default)
   * or our expense voucher, credited to the employee liability that payroll then clears.
   */
  allowancesTo: "payroll" | "bookkeeping";
  /** Salary codes ("lönearter") used for payroll export. */
  salaryCodes: {
    outlay: string;
    perDiemDomesticTaxFree: string;
    perDiemForeignTaxFree: string;
    mileageTaxFree: string;
    mileageTaxable: string;
  };
  approval: {
    defaultApproverId?: string;
    requiredApprovals: number;
  };
  foreignNormalOverrides: Record<string, Ore>;
}
