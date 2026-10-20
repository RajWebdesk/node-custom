"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { StateMessage } from "./StateMessage";

// Status history for one task (Task #9.2). The API decides who can see it, the same as the task.

interface HistoryRow {
  at: string;
  actorName: string;
  fromStatus: string;
  toStatus: string;
}

export function TaskHistory({ taskId }: { taskId: string }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiRequest(`/api/v1/tasks/${encodeURIComponent(taskId)}/history`)
      .then(async (res) => {
        if (!res.ok) {
          setFailed(true);
          return;
        }
        setRows(((await res.json()) as { items: HistoryRow[] }).items);
      })
      .catch(() => setFailed(true));
  }, [taskId]);

  if (failed) return <StateMessage kind="error" />;
  if (!rows) return <StateMessage kind="loading" />;
  return (
    <div className="card">
      <h2>Status history</h2>
      {rows.length === 0 ? <p className="kpi-label">No status changes yet.</p> : null}
      <ul>
        {rows.map((r, i) => (
          <li key={`${r.at}-${i}`}>
            {r.at.slice(0, 16).replace("T", " ")}: {r.fromStatus} to {r.toStatus} by {r.actorName}
          </li>
        ))}
      </ul>
    </div>
  );
}
