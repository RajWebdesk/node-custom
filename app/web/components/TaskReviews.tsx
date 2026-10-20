"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, errorCode, errorText, formatDate } from "../lib/api";
import { StateMessage } from "./StateMessage";

// Review history and submission for one task (Tasks #10.4). The API enforces who may submit and when.

interface ReviewRow {
  submissionId: string;
  revisionNo: number;
  submittedAt: string;
  submitterName: string;
  decision: string | null;
  decidedAt: string | null;
  deciderName: string | null;
}

const SUBMITTABLE = ["To Do", "In Progress", "Revision requested"];

export function TaskReviews({
  taskId,
  status,
  archived,
  mayPropose,
  onChanged,
}: {
  taskId: string;
  status: string;
  archived: boolean;
  // True for the assignee and for managers. The API still decides.
  mayPropose: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(`/api/v1/tasks/${encodeURIComponent(taskId)}/reviews`);
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setRows(((await res.json()) as { items: ReviewRow[] }).items);
    } catch {
      setFailed(true);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const last = rows && rows.length > 0 ? rows[rows.length - 1].decision : null;
  const canSubmitNow =
    mayPropose && !archived && (SUBMITTABLE.includes(status) || (status === "In Review" && last === "reject"));

  async function submitForReview() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiRequest(`/api/v1/tasks/${encodeURIComponent(taskId)}/submissions`, { method: "POST", body: {} });
      if (res.ok) {
        setMessage({ kind: "ok", text: "Submitted for review." });
        await load();
        onChanged();
        return;
      }
      setMessage({ kind: "error", text: errorText(await errorCode(res)) });
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server. Try again later." });
    } finally {
      setSaving(false);
    }
  }

  if (failed) return <StateMessage kind="error" />;
  if (!rows) return <StateMessage kind="loading" />;

  return (
    <div className="card">
      <h2>Review history</h2>
      {message ? (
        <div className={message.kind === "ok" ? "state state-empty" : "state state-error"} role={message.kind === "ok" ? "status" : "alert"}>
          <p>{message.text}</p>
        </div>
      ) : null}
      {canSubmitNow ? (
        <button className="button" type="button" disabled={saving} onClick={() => void submitForReview()}>
          {last === "reject" ? "Send a new revision" : "Submit for review"}
        </button>
      ) : null}
      {rows.length === 0 ? <p className="kpi-label">Not submitted for review yet.</p> : null}
      <ul>
        {rows.map((r) => (
          <li key={r.submissionId}>
            Revision {r.revisionNo}: submitted by {r.submitterName} on {formatDate(r.submittedAt)}.{" "}
            {r.decision ? `${r.decision} by ${r.deciderName ?? "a reviewer"} on ${formatDate(r.decidedAt)}.` : "Awaiting a decision."}
          </li>
        ))}
      </ul>
    </div>
  );
}
