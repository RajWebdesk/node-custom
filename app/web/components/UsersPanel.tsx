"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { StateMessage } from "./StateMessage";

// Administrator user management (Task #5.2). Reads and writes go to the API, which enforces the rules.
// Hiding this page from non-administrators is convenience only; the API returns 403 regardless.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Role = "ADMINISTRATOR" | "MANAGER" | "EMPLOYEE";

const ROLE_LABELS: Record<Role, string> = {
  ADMINISTRATOR: "Administrator",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

interface UserRow {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  status: "active" | "deactivated";
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; users: UserRow[] }
  | { kind: "no-access" }
  | { kind: "error" };

// Maps API error codes to plain next steps. Never shows raw server detail.
const SAVE_MESSAGES: Record<string, string> = {
  "email-taken": "That email is already registered.",
  "self-change-refused": "You cannot deactivate yourself or remove your own Administrator role.",
  "validation-failed": "Check the name, email, and role, then try again.",
  "csrf-check-failed": "Your session check failed. Sign in again and retry.",
};

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return SAVE_MESSAGES[body.error ?? ""] ?? "Could not save. Try again later.";
}

export function UsersPanel() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("EMPLOYEE");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<Role>("EMPLOYEE");
  // A reset token is shown once, to the administrator, for the person it is issued to (Task #4.3).
  const [issued, setIssued] = useState<{ name: string; token: string; expiresAt: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/users`, { credentials: "include" });
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (res.status === 403) {
        setState({ kind: "no-access" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const body = (await res.json()) as { users: UserRow[] };
      setState({ kind: "ready", users: body.users });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Writes send the CSRF token held for this session (see LoginForm). A 401 means the session ended.
  async function send(method: "POST" | "PATCH", path: string, body: unknown): Promise<Response | null> {
    const csrf = sessionStorage.getItem("csrfToken") ?? "";
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        window.location.assign("/login");
        return null;
      }
      return res;
    } catch {
      setMessage("Could not reach the server. Try again later.");
      return null;
    }
  }

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await send("POST", "/api/v1/admin/users", { name, email, roles: [role] });
    setSaving(false);
    if (!res) return;
    if (res.status === 201) {
      setName("");
      setEmail("");
      setRole("EMPLOYEE");
      setMessage("User created. Issue a password reset token so they can set a password.");
      void load();
      return;
    }
    setMessage(await readError(res));
  }

  async function onToggle(user: UserRow) {
    const next = user.status === "active" ? "deactivated" : "active";
    setMessage(null);
    const res = await send("PATCH", `/api/v1/admin/users/${encodeURIComponent(user.id)}`, { status: next });
    if (!res) return;
    if (res.ok) {
      setMessage(next === "deactivated" ? `${user.name} was deactivated and signed out.` : `${user.name} was reactivated.`);
      void load();
      return;
    }
    setMessage(await readError(res));
  }

  async function onIssueToken(user: UserRow) {
    setMessage(null);
    setIssued(null);
    const res = await send("POST", `/api/v1/admin/users/${encodeURIComponent(user.id)}/reset-token`, {});
    if (!res) return;
    if (res.status === 201) {
      const body = (await res.json()) as { token: string; expiresAt: string };
      setIssued({ name: user.name, token: body.token, expiresAt: body.expiresAt });
      return;
    }
    setMessage(await readError(res));
  }

  function startEdit(user: UserRow) {
    setEditingId(user.id);
    setEditName(user.name);
    setEditRole(user.roles[0] ?? "EMPLOYEE");
    setMessage(null);
  }

  // Changing the role replaces the user's roles with this single role. The API revokes their sessions.
  async function onSaveEdit(event: React.FormEvent<HTMLFormElement>, user: UserRow) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": sessionStorage.getItem("csrfToken") ?? "" },
        body: JSON.stringify({ name: editName, roles: [editRole] }),
      });
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (res.ok) {
        setEditingId(null);
        setMessage(`${editName} was saved. If the role changed, the user has been signed out.`);
        void load();
        return;
      }
      setMessage(await readError(res));
    } catch {
      setMessage("Could not reach the server. Try again later.");
    } finally {
      setSaving(false);
    }
  }

  if (state.kind === "loading") return <StateMessage kind="loading" />;
  if (state.kind === "no-access") return <StateMessage kind="no-access" />;
  if (state.kind === "error") return <StateMessage kind="error" />;

  return (
    <>
      <form className="card" onSubmit={onCreate} aria-label="Create user">
        <h2>Add a user</h2>
        <div className="field">
          <label htmlFor="new-name">Name</label>
          <input id="new-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new-email">Email</label>
          <input
            id="new-email"
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-role">Role</label>
          <select id="new-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <button className="button" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Add user"}
        </button>
      </form>

      {issued ? (
        <div className="card" role="status" aria-label="Reset token">
          <h2>Reset token for {issued.name}</h2>
          <p>Give this to {issued.name} through a secure channel. It is shown once, works once, and expires at {issued.expiresAt.slice(0, 16).replace("T", " ")} UTC.</p>
          <p><code>{issued.token}</code></p>
          <p>They open the sign-in help and enter it with a new password of at least 12 characters.</p>
          <button className="button" type="button" onClick={() => setIssued(null)}>Done</button>
        </div>
      ) : null}

      {message ? (
        <div className="state state-empty" role="status">
          <p>{message}</p>
        </div>
      ) : null}

      {state.users.length === 0 ? (
        <StateMessage kind="empty" />
      ) : (
        <div className="card table-wrap">
          <table>
            <caption>Users. Changes take effect immediately and sign the user out when deactivated.</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Roles</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {state.users.map((user) => (
                <Fragment key={user.id}>
                <tr>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>{user.roles.map((r) => ROLE_LABELS[r]).join(", ")}</td>
                  <td>{user.status === "active" ? "Active" : "Deactivated"}</td>
                  <td>
                    <button className="button" type="button" onClick={() => startEdit(user)}>
                      Edit
                    </button>{" "}
                    <button className="button" type="button" onClick={() => void onToggle(user)}>
                      {user.status === "active" ? "Deactivate" : "Reactivate"}
                    </button>{" "}
                    <button className="button" type="button" onClick={() => void onIssueToken(user)} disabled={user.status !== "active"}>
                      Issue reset token
                    </button>
                  </td>
                </tr>
                {editingId === user.id ? (
                  <tr>
                    <td colSpan={5}>
                      <form onSubmit={(e) => void onSaveEdit(e, user)} aria-label={`Edit ${user.name}`}>
                        <div className="field">
                          <label htmlFor={`edit-name-${user.id}`}>Name</label>
                          <input
                            id={`edit-name-${user.id}`}
                            required
                            maxLength={200}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-role-${user.id}`}>Role</label>
                          <select id={`edit-role-${user.id}`} value={editRole} onChange={(e) => setEditRole(e.target.value as Role)}>
                            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button className="button" type="submit" disabled={saving}>
                          Save changes
                        </button>{" "}
                        <button className="button" type="button" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </form>
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
