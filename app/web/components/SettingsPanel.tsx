"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { StateMessage } from "./StateMessage";
import { TaskListsEditor } from "./TaskListsEditor";

// Settings (Task #13.4). Administrators see the approved values and role rules, read-only.
// Everyone sees a link to their own profile settings. The API checks the administrator role.

interface Settings {
  settings: {
    timezone: string;
    reminderSlot: string;
    sessionMinutes: number;
    resetTokenMinutes: number;
    passwordMinLength: number;
    emailMode: string;
  };
  roles: { role: string; label: string }[];
  permissionMatrix: { module: string; Administrator: string; Manager: string; Employee: string }[];
}

const EMAIL_TEXT: Record<string, string> = {
  "pilot-suppressed": "Pilot: no emails are sent. Each message is recorded as suppressed.",
  "provider-not-integrated": "A provider is configured but not integrated yet. No emails are sent.",
};

export function SettingsPanel() {
  const [data, setData] = useState<Settings | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "no-access" | "error">("loading");

  useEffect(() => {
    apiRequest("/api/v1/admin/settings")
      .then(async (res) => {
        if (res.status === 403) {
          setState("no-access");
          return;
        }
        if (!res.ok) {
          setState("error");
          return;
        }
        setData((await res.json()) as Settings);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  return (
    <>
      <div className="card">
        <h2>Your profile</h2>
        <p>Change your display name and password on your profile page.</p>
        <p>
          <Link className="button" href="/profile">
            Open profile settings
          </Link>
        </p>
      </div>

      {state === "loading" ? <StateMessage kind="loading" /> : null}
      {state === "no-access" ? <StateMessage kind="no-access" detail="System settings are for administrators." /> : null}
      {state === "error" ? <StateMessage kind="error" /> : null}

      {state === "ready" && data ? (
        <>
          <section className="card" aria-label="System settings">
            <h2>System settings</h2>
            <p className="kpi-label">
              These are the approved values. Changing one needs a new decision and a release; they cannot be edited here.
            </p>
            <dl>
              <dt>Timezone</dt>
              <dd>{data.settings.timezone} (drives reminders and report dates)</dd>
              <dt>Reminder time</dt>
              <dd>{data.settings.reminderSlot} each day</dd>
              <dt>Session length</dt>
              <dd>{data.settings.sessionMinutes} minutes</dd>
              <dt>Reset link validity</dt>
              <dd>{data.settings.resetTokenMinutes} minutes, single use</dd>
              <dt>Minimum password length</dt>
              <dd>{data.settings.passwordMinLength} characters</dd>
              <dt>Email</dt>
              <dd>{EMAIL_TEXT[data.settings.emailMode] ?? "Not configured."}</dd>
            </dl>
          </section>

          <section className="card" aria-label="Roles and permissions">
            <h2>Roles and permissions</h2>
            <p className="kpi-label">Fixed by the approved role rules. There is no custom permission builder.</p>
            <div className="table-wrap">
              <table>
                <caption>What each role can do</caption>
                <thead>
                  <tr>
                    <th scope="col">Module</th>
                    {data.roles.map((r) => (
                      <th key={r.role} scope="col">
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.permissionMatrix.map((row) => (
                    <tr key={row.module}>
                      <th scope="row">{row.module}</th>
                      <td>{row.Administrator}</td>
                      <td>{row.Manager}</td>
                      <td>{row.Employee}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <TaskListsEditor />
        </>
      ) : null}
    </>
  );
}
