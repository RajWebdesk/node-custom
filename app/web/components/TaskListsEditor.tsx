"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { listsFrom } from "../lib/use-task-lists";
import { StateMessage } from "./StateMessage";

// Status and priority lists (Task #13.3). Administrators add or change the extra statuses and the priorities.
// The built-in statuses are protected: the approval workflow depends on them, so they are shown but not editable.

interface ListsResponse {
  statuses: { value: string; protected: boolean }[];
  priorities: string[];
}

const MESSAGES: Record<string, (value: string) => string> = {
  "protected-status": (v) => `"${v}" is a built-in status and cannot be added again or changed.`,
  "in-use": (v) => `"${v}" is still used by tasks. Move those tasks to another value before removing it.`,
  duplicate: (v) => `"${v}" is listed more than once.`,
  "duplicate-value": (v) => `"${v}" is listed more than once.`,
  "invalid-value": () => "Each value needs between 1 and 40 characters.",
  "too-many": () => "There are too many values in that list.",
  "priority-required": () => "At least one priority is needed.",
};

function linesOf(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

export function TaskListsEditor() {
  const [protectedStatuses, setProtectedStatuses] = useState<string[]>([]);
  const [statusText, setStatusText] = useState("");
  const [priorityText, setPriorityText] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiRequest("/api/v1/task-lists")
      .then(async (res) => {
        if (!res.ok) {
          setState("error");
          return;
        }
        const body = (await res.json()) as ListsResponse;
        const lists = listsFrom(body);
        setProtectedStatuses(body.statuses.filter((s) => s.protected).map((s) => s.value));
        setStatusText(lists.statuses.filter((s) => !body.statuses.find((x) => x.value === s)?.protected).join("\n"));
        setPriorityText(body.priorities.join("\n"));
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await apiRequest("/api/v1/admin/task-lists", {
        method: "PUT",
        body: { statuses: linesOf(statusText), priorities: linesOf(priorityText) },
      });
      if (res.ok) {
        setSaved(true);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; value?: string | null };
      const build = body.error ? MESSAGES[body.error] : undefined;
      setMessage(build ? build(body.value ?? "") : "Could not save the lists. Try again later.");
    } catch {
      setMessage("Could not reach the server. Try again later.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-label="Task lists">
      <h2>Task statuses and priorities</h2>
      {state === "loading" ? <StateMessage kind="loading" /> : null}
      {state === "error" ? <StateMessage kind="error" /> : null}
      {state === "ready" ? (
        <form onSubmit={onSave} noValidate>
          <p className="kpi-label">
            Built-in statuses are protected. The approval workflow depends on them: {protectedStatuses.join(", ")}.
          </p>
          <div className="field">
            <label htmlFor="extra-statuses">Additional statuses (one per line)</label>
            <textarea id="extra-statuses" rows={4} value={statusText} onChange={(e) => setStatusText(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="priorities">Priorities (one per line)</label>
            <textarea id="priorities" rows={4} value={priorityText} onChange={(e) => setPriorityText(e.target.value)} />
          </div>
          <p className="kpi-label">A value that tasks still use cannot be removed.</p>
          <button className="button" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save task lists"}
          </button>
          {saved ? <p role="status">Task lists saved.</p> : null}
          {message ? <div className="state state-error" role="alert"><p>{message}</p></div> : null}
        </form>
      ) : null}
    </section>
  );
}
