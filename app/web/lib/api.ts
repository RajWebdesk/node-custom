// Shared API client for the web app. The API enforces every rule; these helpers only send requests and show results.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Interim lists (PLACEHOLDER: the spec does not define them). Must match app/src/domain/tasks.ts.
export const TASK_STATUSES = ["To Do", "In Progress", "In Review", "Approved", "Revision requested"] as const;
export const FREE_STATUSES = ["To Do", "In Progress"] as const;
export const TASK_PRIORITIES = ["Low", "Medium", "High"] as const;

export interface Me {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  assigneeId: string;
  pmId: string;
  reviewerId: string;
  startDate: string | null;
  dueDate: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface AssignableUser {
  id: string;
  name: string;
  isDesignatedReviewer: boolean;
}

export function isManager(roles: string[]): boolean {
  return roles.includes("ADMINISTRATOR") || roles.includes("MANAGER");
}

// Sends a request with credentials. Writes carry the CSRF token held for this session (see LoginForm).
// A 401 means the session ended, so the user goes back to sign-in.
export async function apiRequest(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = sessionStorage.getItem("csrfToken") ?? "";
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401) window.location.assign("/login");
  return res;
}

export async function errorCode(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "unknown";
}

// Plain next steps for each error code. Never shows raw server detail.
const ERROR_TEXT: Record<string, string> = {
  "validation-failed": "Check the highlighted fields and try again.",
  "invalid-dates": "The due date cannot be before the start date.",
  "invalid-assignee": "Choose an active assignee.",
  "invalid-reviewer": "Choose an active designated reviewer.",
  "workflow-controlled": "The approval workflow sets this status. Use the review process to change it.",
  "same-status": "The task is already in that status.",
  archived: "This task is archived. Unarchive it to make changes.",
  "stale-status": "Someone else changed this task. The board has been refreshed.",
  "csrf-check-failed": "Your session check failed. Sign in again and retry.",
  forbidden: "You do not have permission to do that.",
  "not-found": "This task could not be found.",
};

export function errorText(code: string): string {
  return ERROR_TEXT[code] ?? "Could not save. Try again later.";
}

// Dates are entered as calendar dates and stored as UTC midnight (prototype; time zone handling is a later task).
export function toIsoDate(value: string): string | null {
  return value ? `${value}T00:00:00Z` : null;
}

export function fromIsoDate(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

export function formatDate(value: string | null): string {
  return value ? value.slice(0, 10) : "—";
}
