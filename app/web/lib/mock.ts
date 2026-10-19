// Mock data for the prototype only. Not real records. Replace with API data after authentication is approved.

export const mockKpis = [
  { label: "Open tasks", value: "12" },
  { label: "Awaiting review", value: "3" },
  { label: "Overdue", value: "2" },
  { label: "Planned this week", value: "38 h" },
];

export const mockTasks = [
  { title: "Sample task A", status: "In Review", due: "Sample date", plannedHours: 8 },
  { title: "Sample task B", status: "In Progress", due: "Sample date", plannedHours: 5 },
];

export const mockUsers = [
  { name: "Sample User A", email: "sample-a@example.test", role: "Administrator", status: "active" },
  { name: "Sample User B", email: "sample-b@example.test", role: "Manager", status: "active" },
  { name: "Sample User C", email: "sample-c@example.test", role: "Employee", status: "deactivated" },
];

export const mockAllocations = [
  { subject: "Sample person A", plannedHours: 20, updatedBy: "Sample admin", updatedAt: "Sample date" },
  { subject: "Sample person B", plannedHours: 18, updatedBy: "Sample admin", updatedAt: "Sample date" },
];

export const mockNotifications = [
  { kind: "Task submitted for review", task: "Sample task A", read: "No" },
  { kind: "Task rejected", task: "Sample task B", read: "Yes" },
];

export const mockActivity = [
  { when: "Sample time", actor: "Sample user A", action: "Submitted task for review" },
  { when: "Sample time", actor: "Sample user B", action: "Recorded a rejection; task stays In Review" },
];

export const mockTemplates = [
  { name: "Password reset (administrator-issued)", state: "Draft text placeholder" },
  { name: "User invitation", state: "Draft text placeholder" },
];

// Role-by-module matrix. Auth surfaces (Login, Forgot Password) are not rows.
export const roleMatrix = [
  { module: "Tasks", Administrator: "View, Create, Edit", Manager: "View, Create, Edit", Employee: "View" },
  { module: "Reviews", Administrator: "View", Manager: "View; Approve (designated reviewer only)", Employee: "View" },
  { module: "Time", Administrator: "View, Edit", Manager: "View", Employee: "View" },
  { module: "Users", Administrator: "View, Create, Edit", Manager: "View", Employee: "None" },
];
