"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, isManager, type Me } from "../lib/api";
import { StateMessage } from "./StateMessage";

// Activity log (Task #9.2). Administrators only. The API refuses everyone else; this page only shows the result.

interface ActivityItem {
  at: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
}

const PAGE_SIZE = 25;

export function ActivityPanel() {
  const [me, setMe] = useState<Me | null | "none">(null);
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: ActivityItem[]; total: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiRequest("/api/v1/me").then(async (res) => {
      setMe(res.ok ? ((await res.json()) as Me) : "none");
    });
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (entityType.trim()) params.set("entityType", entityType.trim());
    if (action.trim()) params.set("action", action.trim());
    try {
      const res = await apiRequest(`/api/v1/activity?${params.toString()}`);
      if (res.status === 403) {
        setFailed(true);
        return;
      }
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setData((await res.json()) as { items: ActivityItem[]; total: number });
    } catch {
      setFailed(true);
    }
  }, [page, entityType, action]);

  useEffect(() => {
    if (me && me !== "none" && me.roles.includes("ADMINISTRATOR")) void load();
  }, [me, load]);

  if (me === null) return <StateMessage kind="loading" />;
  if (me === "none" || !me.roles.includes("ADMINISTRATOR")) {
    return <StateMessage kind="no-access" detail={me !== "none" && isManager(me.roles) ? "The activity log is for administrators." : undefined} />;
  }
  if (failed) return <StateMessage kind="error" />;

  const pageCount = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <div className="card" role="search" aria-label="Filter activity">
        <div className="field">
          <label htmlFor="filter-entity">Record type</label>
          <select id="filter-entity" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="Task">Task</option>
            <option value="User">User</option>
            <option value="Allocation">Allocation</option>
            <option value="ApprovalSubmission">Approval</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-action">Action</label>
          <select id="filter-action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            <option value="">All actions</option>
            <option value="task.created">Task created</option>
            <option value="task.updated">Task updated</option>
            <option value="task.status_changed">Task status changed</option>
            <option value="task.archived">Task archived</option>
            <option value="task.restored">Task restored</option>
            <option value="user.created">User created</option>
            <option value="user.updated">User updated</option>
            <option value="user.password_changed">Password changed</option>
            <option value="user.reset_token_issued">Reset token issued</option>
            <option value="allocation.adjusted">Planned hours changed</option>
            <option value="approval.decision_recorded">Approval decision</option>
          </select>
        </div>
      </div>

      {data && data.total === 0 ? <StateMessage kind="empty" detail="No activity matches these filters." /> : null}
      {data && data.total > 0 ? (
        <div className="card table-wrap">
          <table>
            <caption>
              Activity. {data.total} records. Page {page} of {pageCount}. Records cannot be changed or deleted.
            </caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">Record</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r, i) => (
                <tr key={`${r.at}-${i}`}>
                  <td>{r.at.slice(0, 16).replace("T", " ")}</td>
                  <td>{r.actorName}</td>
                  <td>{r.action}</td>
                  <td>
                    {r.entityType} {r.entityId.slice(0, 8)}
                  </td>
                  <td>
                    <code>{JSON.stringify(r.payload)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <nav aria-label="Pages">
            <button className="button" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>{" "}
            <button className="button" type="button" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </nav>
        </div>
      ) : null}
      {!data && !failed ? <StateMessage kind="loading" /> : null}
    </>
  );
}
