import { randomBytes } from "node:crypto";
import type { Role } from "../domain/roles.js";

// Administrator user management (spec Module 5, Task #5.1). The view never carries the password hash.

export type UserStatus = "active" | "deactivated";

export interface UserView {
  id: string;
  name: string;
  email: string;
  roles: readonly Role[];
  status: UserStatus;
  isDesignatedReviewer: boolean;
}

export interface NewUser {
  name: string;
  email: string;
  roles: readonly Role[];
  passwordHash: string;
}

export interface UserPatch {
  name?: string;
  roles?: readonly Role[];
  status?: UserStatus;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("email-taken");
  }
}

export interface UserDirectory {
  list(): Promise<UserView[]>;
  findById(id: string): Promise<UserView | null>;
  // Throws DuplicateEmailError when the email is already registered.
  create(input: NewUser): Promise<UserView>;
  // Returns null when the user does not exist.
  update(id: string, patch: UserPatch): Promise<UserView | null>;
}

// Prototype and test store. The Prisma-backed store is in prisma-stores.ts.
export class InMemoryUserDirectory implements UserDirectory {
  private readonly rows = new Map<string, UserView>();

  constructor(seed: UserView[] = []) {
    for (const row of seed) this.rows.set(row.id, { ...row, roles: [...row.roles] });
  }

  async list(): Promise<UserView[]> {
    return [...this.rows.values()].map((row) => ({ ...row, roles: [...row.roles] }));
  }

  async findById(id: string): Promise<UserView | null> {
    const row = this.rows.get(id);
    return row ? { ...row, roles: [...row.roles] } : null;
  }

  async create(input: NewUser): Promise<UserView> {
    for (const row of this.rows.values()) {
      if (row.email === input.email) throw new DuplicateEmailError();
    }
    const row: UserView = {
      id: randomBytes(16).toString("hex"),
      name: input.name,
      email: input.email,
      roles: [...input.roles],
      status: "active",
      isDesignatedReviewer: false,
    };
    this.rows.set(row.id, row);
    return { ...row, roles: [...row.roles] };
  }

  async update(id: string, patch: UserPatch): Promise<UserView | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.roles !== undefined) row.roles = [...patch.roles];
    if (patch.status !== undefined) row.status = patch.status;
    return { ...row, roles: [...row.roles] };
  }
}
