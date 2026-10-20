"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  apiRequest,
  errorCode,
  errorText,
  FREE_STATUSES,
  isManager,
  TASK_STATUSES,
  type AssignableUser,
  type Me,
  type Task,
} from "../lib/api";
import { StateMessage } from "./StateMessage";

// Kanban board (Task #7.3). Drag-and-drop and the keyboard "Move to" control call the same status endpoint,
// so the server applies the same transition rules to both. Approval-controlled columns accept no drops.

export function KanbanBoard() {
  const [me, setMe] = useState<Me | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [users, setUsers] = useState<Map<string, string>>(new Map());
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const manager = me ? isManager(me.roles) : false;

  const load = useCallback(async () => {
    try {
      // The API caps page size at 100. A board of more tasks needs a per-column query (later work).
      const res = await apiRequest("/api/v1/tasks?pageSize=100&sortBy=dueDate&sortDir=asc");
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setTasks(((await res.json()) as { items: Task[] }).items);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    apiRequest("/api/v1/me").then(async (res) => {
      if (res.ok) setMe((await res.json()) as Me);
    });
    void load();
  }, [load]);

  useEffect(() => {
    if (!me || !isManager(me.roles)) return;
    apiRequest("/api/v1/directory/users").then(async (res) => {
      if (!res.ok) return;
      const body = (await res.json()) as { users: AssignableUser[] };
      setUsers(new Map(body.users.map((u) => [u.id, u.name])));
    });
  }, [me]);

  async function move(task: Task, status: string) {
    if (status === task.status) return;
    setMessage(null);
    const res = await apiRequest(`/api/v1/tasks/${encodeURIComponent(task.id)}/status`, { method: "POST", body: { status } });
    if (res.ok) {
      setMessage({ kind: "ok", text: `${task.title} moved to ${status}.` });
      await load();
      return;
    }
    const code = await errorCode(res);
    setMessage({ kind: "error", text: errorText(code) });
    // A stale move means the board is out of date, so reload it.
    if (code === "stale-status") await load();
  }

  if (failed) return <StateMessage kind="error" />;
  if (!tasks || !me) return <StateMessage kind="loading" />;

  const active = tasks.filter((t) => t.archivedAt === null);
  const columns = TASK_STATUSES.map((status) => ({
    status,
    free: (FREE_STATUSES as readonly string[]).includes(status),
    tasks: active.filter((t) => t.status === status),
  }));

  return (
    <>
      {message ? (
        <div className={message.kind === "ok" ? "state state-empty" : "state state-error"} role={message.kind === "ok" ? "status" : "alert"}>
          <p>{message.text}</p>
        </div>
      ) : null}
      <p className="kpi-label">
        {manager
          ? "Drag a card to To Do or In Progress, or use its Move to control. Review columns change only through the approval workflow."
          : "You see only the tasks assigned to you. Only managers move tasks."}
      </p>
      <div className="board" role="list" aria-label="Task board">
        {columns.map((col) => (
          <section
            key={col.status}
            className="board-column card"
            role="listitem"
            aria-label={`${col.status}, ${col.tasks.length} tasks`}
            onDragOver={(e) => {
              // Only free columns accept a drop. Workflow columns do not call preventDefault, so the browser refuses the drop.
              if (manager && col.free && dragging) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const task = tasks.find((t) => t.id === dragging);
              setDragging(null);
              if (task && manager && col.free) void move(task, col.status);
            }}
          >
            <h2>
              {col.status} <span className="kpi-label">({col.tasks.length})</span>
            </h2>
            {!col.free ? <p className="kpi-label">Set by the approval workflow.</p> : null}
            {col.tasks.length === 0 ? <p className="kpi-label">No tasks.</p> : null}
            {col.tasks.map((t) => (
              <article
                key={t.id}
                className="card"
                draggable={manager && FREE_STATUSES.includes(t.status as (typeof FREE_STATUSES)[number])}
                onDragStart={() => setDragging(t.id)}
                onDragEnd={() => setDragging(null)}
                aria-label={t.title}
              >
                <p>
                  <Link href={`/tasks/${t.id}`}>{t.title}</Link>
                </p>
                <p className="kpi-label">
                  {t.priority} · {manager ? users.get(t.assigneeId) ?? "Assigned user" : "Assigned to you"}
                </p>
                {manager && (FREE_STATUSES as readonly string[]).includes(t.status) ? (
                  <label>
                    <span className="kpi-label">Move to</span>
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) void move(t, e.target.value);
                      }}
                    >
                      <option value="">Choose status</option>
                      {FREE_STATUSES.filter((s) => s !== t.status).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </article>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
