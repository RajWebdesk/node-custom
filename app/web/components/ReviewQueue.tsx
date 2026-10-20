"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, formatDate } from "../lib/api";
import { StateMessage } from "./StateMessage";

// Reviewer queue (Task #10.3). The API returns only submissions waiting for the designated reviewer.

interface QueueItem {
  submissionId: string;
  taskId: string;
  taskTitle: string;
  submitterName: string;
  revisionNo: number;
  submittedAt: string;
}

export function ReviewQueue() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "no-access" | "error">("loading");

  useEffect(() => {
    apiRequest("/api/v1/reviews")
      .then(async (res) => {
        if (res.status === 403) {
          setState("no-access");
          return;
        }
        if (!res.ok) {
          setState("error");
          return;
        }
        setItems(((await res.json()) as { items: QueueItem[] }).items);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  if (state === "loading") return <StateMessage kind="loading" />;
  if (state === "no-access") return <StateMessage kind="no-access" detail="Only the designated reviewer sees the review queue." />;
  if (state === "error") return <StateMessage kind="error" />;
  if (!items || items.length === 0) return <StateMessage kind="empty" detail="No submissions are waiting for your decision." />;

  return (
    <div className="card table-wrap">
      <table>
        <caption>Waiting for your decision. Oldest first.</caption>
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Submitted by</th>
            <th scope="col">Revision</th>
            <th scope="col">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.submissionId}>
              <td>
                <Link href={`/reviews/${i.submissionId}`}>{i.taskTitle}</Link>
              </td>
              <td>{i.submitterName}</td>
              <td>{i.revisionNo}</td>
              <td>{formatDate(i.submittedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
