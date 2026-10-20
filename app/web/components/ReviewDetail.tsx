"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, errorCode, errorText, formatDate } from "../lib/api";
import { StateMessage } from "./StateMessage";

// Review detail with the approve, revise, and reject controls (Task #10.3). The API decides who may act.

interface Detail {
  id: string;
  taskId: string;
  taskTitle: string;
  revisionNo: number;
  submittedAt: string;
  submitterName: string;
  decision: string | null;
  decidedAt: string | null;
  deciderName: string | null;
  canDecide: boolean;
}

const DECISIONS = [
  { value: "approve", label: "Approve" },
  { value: "revise", label: "Request revision" },
  { value: "reject", label: "Reject" },
] as const;

export function ReviewDetail({ submissionId }: { submissionId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(`/api/v1/submissions/${encodeURIComponent(submissionId)}`);
      if (res.status === 404) {
        setState("missing");
        return;
      }
      if (!res.ok) {
        setState("error");
        return;
      }
      setDetail((await res.json()) as Detail);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(decision: string) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiRequest(`/api/v1/submissions/${encodeURIComponent(submissionId)}/decisions`, { method: "POST", body: { decision } });
      if (res.ok) {
        const body = (await res.json()) as { taskStatus: string };
        setMessage({ kind: "ok", text: `Decision recorded. The task is now ${body.taskStatus}.` });
        await load();
        return;
      }
      setMessage({ kind: "error", text: errorText(await errorCode(res)) });
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server. Try again later." });
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") return <StateMessage kind="loading" />;
  if (state === "missing") return <StateMessage kind="no-access" detail="This submission does not exist or is not visible to you." />;
  if (state === "error" || !detail) return <StateMessage kind="error" />;

  return (
    <>
      <p>
        <Link href="/reviews">Back to the review queue</Link>
      </p>
      {message ? (
        <div className={message.kind === "ok" ? "state state-empty" : "state state-error"} role={message.kind === "ok" ? "status" : "alert"}>
          <p>{message.text}</p>
        </div>
      ) : null}
      <div className="card">
        <h1>{detail.taskTitle}</h1>
        <p>
          Revision {detail.revisionNo}, submitted by {detail.submitterName} on {formatDate(detail.submittedAt)}.
        </p>
        {detail.decision ? (
          <p>
            Decision: {detail.decision} by {detail.deciderName ?? "a reviewer"} on {formatDate(detail.decidedAt)}.
          </p>
        ) : (
          <p className="kpi-label">Awaiting a decision.</p>
        )}
        <p>
          <Link href={`/tasks/${detail.taskId}`}>Open the task</Link>
        </p>
      </div>
      {detail.canDecide ? (
        <div className="card" role="group" aria-label="Decide">
          {DECISIONS.map((d) => (
            <button key={d.value} className="button" type="button" disabled={saving} onClick={() => void decide(d.value)}>
              {d.label}
            </button>
          ))}
          <p className="kpi-label">Rejecting keeps the task In Review. The submitter can then send a new revision.</p>
        </div>
      ) : null}
    </>
  );
}
