// Roles from sow-spec "Application roles and pilot accounts":
// Administrator, Manager, Employee. A Manager is not automatically a reviewer.

export const ROLES = ["ADMINISTRATOR", "MANAGER", "EMPLOYEE"] as const;
export type Role = (typeof ROLES)[number];

export interface Actor {
  id: string;
  roles: readonly Role[];
  // True only for the designated reviewer (AS in the spec). Not implied by the Manager role.
  isDesignatedReviewer: boolean;
}

// Only the Administrator changes allocated time (sow-spec Rules that must hold).
export function canChangeAllocation(actor: Actor): boolean {
  return actor.roles.includes("ADMINISTRATOR");
}

// Only the Administrator manages users and roles (sow-spec Module 5, Task #5.1).
export function canManageUsers(actor: Actor): boolean {
  return actor.roles.includes("ADMINISTRATOR");
}
