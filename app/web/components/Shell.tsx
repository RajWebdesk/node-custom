import type { ReactNode } from "react";

// Module list from the approved module inclusion file (outputs/custom-app/docs/design/dashboard-ui/dashboard-module-inclusion.json).
// Admin-only items are shown here for the prototype. Real visibility depends on server-side authorization, not on this list.
const NAV: { href: string; label: string; current?: boolean }[] = [
  { href: "/", label: "Dashboard", current: true },
  { href: "/login", label: "Sign in" },
  { href: "/tasks", label: "Tasks" },
  { href: "/reviews", label: "Reviews" },
  { href: "/time", label: "Time" },
  { href: "/notifications", label: "Notifications" },
  { href: "/reports", label: "Reports" },
  { href: "/users", label: "Users" },
  { href: "/roles", label: "Roles" },
  { href: "/email-templates", label: "Email templates" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
];

export function Shell({ current, children }: { current: string; children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="shell">
        <aside className="sidebar">
          <nav aria-label="Main">
            <ul>
              {NAV.map((item) => {
                const isCurrent = item.label === current;
                return (
                  <li key={item.label}>
                    <a href={item.href} aria-current={isCurrent ? "page" : undefined}>
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>
        <div>
          <header className="appbar">
            <span>Task &amp; Approval</span>
            <span className="timezone-label">Times shown in America/Toronto</span>
          </header>
          <main id="main" className="main">
            <p className="banner">
              Pilot prototype. Mock data only. Authentication is not implemented. Hiding a nav item is
              convenience, not security.
            </p>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
