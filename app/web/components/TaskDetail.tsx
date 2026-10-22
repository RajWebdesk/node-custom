"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  apiRequest,
  errorCode,
  errorText,
  formatDate,
  isManager,
  type AssignableUser,
  type Me,
  type Task,
} from "../lib/api";
import { StateMessage } from "./StateMessage";
import { useTaskLists } from "../lib/use-task-lists";
import { TaskForm } from "./TaskForm";
import { TaskHistory } from "./TaskHistory";
import { TaskReviews } from "./TaskReviews";

// Task details (Task #7.2). Managers can edit, move between free statuses, and archive. Employees read only.
// The API enforces the same rules for every action.

export function TaskDetail({ taskId }: { taskId: string }) {
  const lists = useTaskLists();
  const [me, setMe] = useState<Me | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const manager = me ? isManager(me.roles) : false;

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(`/api/v1/tasks/${encodeURIComponent(taskId)}`);
      if (res.status === 404) {
        setLoadState("missing");
        return;
      }
      if (!res.ok) {
        setLoadState("error");
        return;
      }
      setTask((await res.json()) as Task);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [taskId]);

  useEffect(() => {
    apiRequest("/api/v1/me").then(async (res) => {
      if (res.ok) setMe((await res.json()) as Me);
    });
    void load();
  }, [load]);

  useEffect(() => {
    if (!me || !isManager(me.roles)) return;
    apiRequest("/api/v1/directory/users").then(async (res) => {
      if (res.ok) setUsers(((await res.json()) as { users: AssignableUser[] }).users);
    });
  }, [me]);

  async function move(status: string) {
    setMessage(null);
    const res = await apiRequest(`/api/v1/tasks/${encodeURIComponent(taskId)}/status`, { method: "POST", body: { status } });
    if (res.ok) {
      setTask((await res.json()) as Task);
      setMessage({ kind: "ok", text: `Status changed to ${status}.` });
      return;
    }
    setMessage({ kind: "error", text: errorText(await errorCode(res)) });
  }

  async function setArchived(archived: boolean) {
    setMessage(null);
    const res = await apiRequest(`/api/v1/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", body: { archived } });
    if (res.ok) {
      setTask((await res.json()) as Task);
      setMessage({ kind: "ok", text: archived ? "Task archived." : "Task restored." });
      return;
    }
    setMessage({ kind: "error", text: errorText(await errorCode(res)) });
  }

  if (loadState === "loading") return <StateMessage kind="loading" />;
  if (loadState === "missing") return <StateMessage kind="no-access" detail="This task does not exist or is not visible to you." />;
  if (loadState === "error" || !task) return <StateMessage kind="error" />;

  // "You" only for the signed-in user. Employees have no user directory, so other people show a neutral label.
  const name = (id: string) => (me !== null && id === me.id ? "You" : users.find((u) => u.id === id)?.name ?? "Assigned user");
  const archived = task.archivedAt !== null;
  const isFree = lists.free.includes(task.status);
  const moves = isFree ? lists.free.filter((s) => s !== task.status) : [];

  return (
    <>
      <p>
        <Link href="/tasks">Back to tasks</Link>
      </p>
      {message ? (
        <div className={message.kind === "ok" ? "state state-empty" : "state state-error"} role={message.kind === "ok" ? "status" : "alert"}>
          <p>{message.text}</p>
        </div>
      ) : null}

      {editing && task ? (
        <TaskForm
          task={task}
          users={users}
          onSaved={(saved) => {
            setTask(saved);
            setEditing(false);
            setMessage({ kind: "ok", text: "Task saved." });
          }}
        />
      ) : (
        <div className="card">
          <h1>{task.title}</h1>
          <dl>
            <dt>Status</dt>
            <dd>{task.status}{archived ? " (archived)" : ""}</dd>
            <dt>Priority</dt>
            <dd>{task.priority}</dd>
            <dt>Assignee</dt>
            <dd>{name(task.assigneeId)}</dd>
            <dt>Designated reviewer</dt>
            <dd>{name(task.reviewerId)}</dd>
            <dt>Start date</dt>
            <dd>{formatDate(task.startDate)}</dd>
            <dt>Due date</dt>
            <dd>{formatDate(task.dueDate)}</dd>
            <dt>Description</dt>
            <dd>{task.description ?? "No description."}</dd>
          </dl>

          {manager ? (
            <div>
              {!archived && !editing ? (
                <button className="button" type="button" onClick={() => setEditing(true)}>
                  Edit task
                </button>
              ) : null}{" "}
              <button className="button" type="button" onClick={() => void setArchived(!archived)}>
                {archived ? "Restore task" : "Archive task"}
              </button>
              {!archived && moves.length > 0 ? (
                <div role="group" aria-label="Move to status">
                  {moves.map((s) => (
                    <button key={s} className="button" type="button" onClick={() => void move(s)}>
                      Move to {s}
                    </button>
                  ))}
                </div>
              ) : null}
              {!archived && !isFree ? (
                <p className="kpi-label">The approval workflow sets the {task.status} status.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <TaskReviews
        taskId={taskId}
        status={task.status}
        archived={archived}
        mayPropose={manager || (me !== null && me.id === task.assigneeId)}
        onChanged={() => void load()}
      />
      <TaskHistory taskId={taskId} />
    </>
  );
}
