import type { Request, Response } from "express";
import { PERMISSION_MATRIX, ROLE_LABELS, systemSettings } from "../domain/settings.js";

// Admin settings view (spec Module 13, Task #13.4). Read-only. Mounted behind requireSession and requireAdministrator.
// The response holds approved values and role rules only: no secrets, connection strings, or provider settings.
export function settingsHandler() {
  return (_req: Request, res: Response) => {
    res.status(200).json({
      settings: systemSettings(process.env),
      roles: Object.entries(ROLE_LABELS).map(([role, label]) => ({ role, label })),
      permissionMatrix: PERMISSION_MATRIX,
    });
  };
}
