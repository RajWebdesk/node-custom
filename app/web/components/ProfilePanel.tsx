"use client";

import { useEffect, useState } from "react";
import { StateMessage } from "./StateMessage";

// Self-service profile and password change (Task #5.2). The API enforces every rule; this page only shows the result.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const ROLE_LABELS: Record<string, string> = {
  ADMINISTRATOR: "Administrator",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

interface Profile {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

// Plain next steps for each API error code. Never shows raw server detail.
const ERROR_MESSAGES: Record<string, string> = {
  "current-password-incorrect": "The current password is not correct.",
  "password-unchanged": "Choose a password that is different from the current one.",
  "validation-failed": "Check the fields and try again. New passwords need at least 12 characters.",
  "csrf-check-failed": "Your session check failed. Sign in again and retry.",
  "authentication-required": "Your session has ended. Sign in again.",
};

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return ERROR_MESSAGES[body.error ?? ""] ?? "Could not save. Try again later.";
}

export function ProfilePanel() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadFailed, setLoadFailed] = useState<"none" | "signed-out" | "error">("none");
  const [name, setName] = useState("");
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/v1/me`, { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401) {
          setLoadFailed("signed-out");
          window.location.assign("/login");
          return;
        }
        if (!res.ok) {
          setLoadFailed("error");
          return;
        }
        const body = (await res.json()) as Profile;
        setProfile(body);
        setName(body.name);
      })
      .catch(() => setLoadFailed("error"));
  }, []);

  async function onSaveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNameMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/me`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": sessionStorage.getItem("csrfToken") ?? "" },
        body: JSON.stringify({ name }),
      });
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (res.ok) {
        const body = (await res.json()) as Profile;
        setProfile(body);
        setName(body.name);
        setNameMessage("Your name was saved.");
      } else {
        setNameMessage(await errorText(res));
      }
    } catch {
      setNameMessage("Could not reach the server. Try again later.");
    } finally {
      setSaving(false);
    }
  }

  async function onChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage(null);
    if (next !== confirm) {
      setPasswordMessage("The new passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/me/password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": sessionStorage.getItem("csrfToken") ?? "" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (res.status === 204) {
        // The server signed every session out, including this one. Sign in again with the new password.
        sessionStorage.removeItem("csrfToken");
        window.location.assign("/login");
        return;
      }
      setPasswordMessage(await errorText(res));
    } catch {
      setPasswordMessage("Could not reach the server. Try again later.");
    } finally {
      setSaving(false);
    }
  }

  if (loadFailed === "error") return <StateMessage kind="error" />;
  if (loadFailed === "signed-out") return <StateMessage kind="loading" />;
  if (!profile) return <StateMessage kind="loading" />;

  return (
    <>
      <div className="card">
        <h2>Your account</h2>
        <p>
          <strong>Email:</strong> {profile.email}
        </p>
        <p>
          <strong>Roles:</strong> {profile.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
        </p>
        <p className="kpi-label">Roles are set by an administrator.</p>
      </div>

      <form className="card" onSubmit={onSaveName} aria-label="Edit name">
        <h2>Name</h2>
        <div className="field">
          <label htmlFor="profile-name">Display name</label>
          <input id="profile-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="button" type="submit" disabled={saving}>
          Save name
        </button>
        {nameMessage ? <p role="status">{nameMessage}</p> : null}
      </form>

      <form className="card" onSubmit={onChangePassword} aria-label="Change password">
        <h2>Change password</h2>
        <p className="kpi-label">Changing your password signs you out everywhere. Sign in again with the new password.</p>
        <div className="field">
          <label htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-password">New password (at least 12 characters)</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={1024}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={1024}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button className="button" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Change password"}
        </button>
        {passwordMessage ? <p role="alert">{passwordMessage}</p> : null}
      </form>
    </>
  );
}
