import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultSettings } from "../core/defaults.ts";
import type { Department, Employee, Report, Settings } from "../core/model.ts";
import { kr } from "../core/money.ts";

// JSON-file persistence. Good enough for a single-company install; swap for a
// database behind the same methods if several companies share one server.

export interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  ownerId: string;
  createdAt: string;
}

export interface FortnoxConnection {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface Db {
  settings: Settings;
  employees: Employee[];
  departments: Department[];
  reports: Report[];
  attachments: Attachment[];
  fortnox?: FortnoxConnection;
}

export function seedDb(): Db {
  const settings = defaultSettings();
  settings.approval.defaultApproverId = "maria";
  return {
    settings,
    employees: [
      { id: "anna", name: "Anna Andersson", employeeNumber: "1", role: "employee", departmentId: "sales" },
      { id: "erik", name: "Erik Ek", employeeNumber: "2", role: "approver", departmentId: "sales", approverId: "maria", approvalLimit: kr(20_000) },
      { id: "maria", name: "Maria Admin", employeeNumber: "3", role: "admin" },
    ],
    departments: [{ id: "sales", name: "Försäljning", approverIds: ["erik"] }],
    reports: [],
    attachments: [],
  };
}

export class Store {
  readonly dir: string;
  db: Db;

  constructor(dir: string | null) {
    this.dir = dir ?? "";
    if (dir) {
      mkdirSync(join(dir, "attachments"), { recursive: true });
      const file = join(dir, "db.json");
      this.db = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Db) : seedDb();
    } else {
      this.db = seedDb();
    }
  }

  /** Writes atomically so a crash never leaves a half-written database. */
  save(): void {
    if (!this.dir) return;
    const file = join(this.dir, "db.json");
    writeFileSync(`${file}.tmp`, JSON.stringify(this.db, null, 2));
    renameSync(`${file}.tmp`, file);
  }

  newId(): string {
    return randomUUID();
  }

  private memoryFiles = new Map<string, Uint8Array>();

  saveAttachment(meta: Omit<Attachment, "id" | "createdAt" | "size">, data: Uint8Array): Attachment {
    const attachment: Attachment = { ...meta, id: this.newId(), size: data.byteLength, createdAt: new Date().toISOString() };
    if (this.dir) writeFileSync(join(this.dir, "attachments", attachment.id), data);
    else this.memoryFiles.set(attachment.id, data);
    this.db.attachments.push(attachment);
    this.save();
    return attachment;
  }

  readAttachment(id: string): Uint8Array {
    if (!this.dir) {
      const data = this.memoryFiles.get(id);
      if (!data) throw new Error("Bilagan finns inte");
      return data;
    }
    return readFileSync(join(this.dir, "attachments", id));
  }
}
