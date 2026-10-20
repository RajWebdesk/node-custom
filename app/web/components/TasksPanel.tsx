"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  apiRequest,
  formatDate,
  isManager,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type AssignableUser,
  type Me,
  type Task,
} from "../lib/api";
import { StateMessage } from "./StateMessage";

// Task list with search, filters, sort, and paging (Task #7.1). The API scopes the rows to the caller.

const PAGE_SIZE = 25;

const SORTS: { value: string; label: string }[] = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "dueDate:asc", label: "Due date (earliest)" },
  { value: "title:asc", label: "Title (A to Z)" },
];

export function TasksPanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<Map<string, string>>(new Map());
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [sort, setSort] = useState("createdAt:desc");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Task[]; total: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiRequest("/api/v1/me").then(async (res) => {
      if (res.ok) setMe((await res.json()) as Me);
    });
  }, []);

  useEffect(() => {
    if (!me || !isManager(me.roles)) return;
    apiRequest("/api/v1/directory/users").then(async (res) => {
      if (!res.ok) return;
      const body = (await res.json()) as { users: AssignableUser[] };
      setUsers(new Map(body.users.map((u) => [u.id, u.name])));
    });
  }, [me]);

  const load = useCallback(async () => {
    const [sortBy, sortDir] = sort.split(":");
    const params = new URLSearchParams({
      sortBy,
      sortDir,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      archived: archived ? "true" : "false",
    });
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    try {
      const res = await apiRequest(`/api/v1/tasks?${params.toString()}`);
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setData((await res.json()) as { items: Task[]; total: number });
    } catch {
      setFailed(true);
    }
  }, [q, status, priority, sort, archived, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any filter change starts again at the first page.
  function changeFilter(set: () => void) {
    set();
    setPage(1);
  }

  const manager = me ? isManager(me.roles) : false;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const nameOf = (id: string) => users.get(id) ?? (manager ? "Assigned user" : "You");

  return (
    <>
      <div className="card" role="search" aria-label="Find tasks">
        <div className="field">
          <label htmlFor="task-search">Search by title</label>
          <input id="task-search" type="search" value={q} onChange={(e) => changeFilter(() => setQ(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="filter-status">Status</label>
          <select id="filter-status" value={status} onChange={(e) => changeFilter(() => setStatus(e.target.value))}>
            <option value="">All statuses</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-priority">Priority</label>
          <select id="filter-priority" value={priority} onChange={(e) => changeFilter(() => setPriority(e.target.value))}>
            <option value="">All priorities</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sort">Sort by</label>
          <select id="sort" value={sort} onChange={(e) => changeFilter(() => setSort(e.target.value))}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <label>
          <input type="checkbox" checked={archived} onChange={(e) => changeFilter(() => setArchived(e.target.checked))} /> Show archived
        </label>
        {manager ? (
          <p>
            <Link className="button" href="/tasks/new">
              New task
            </Link>{" "}
            <Link className="button" href="/tasks/board">
              Open board
            </Link>
          </p>
        ) : null}
      </div>

      {failed ? <StateMessage kind="error" /> : null}
      {!failed && data && data.total === 0 ? <StateMessage kind="empty" detail="No tasks match these filters." /> : null}
      {!failed && data && data.total > 0 ? (
        <div className="card table-wrap">
          <table>
            <caption>
              Tasks. {data.total} found. Page {page} of {pageCount}.
            </caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col">Priority</th>
                <th scope="col">Assignee</th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/tasks/${t.id}`}>{t.title}</Link>
                  </td>
                  <td>{t.status}</td>
                  <td>{t.priority}</td>
                  <td>{nameOf(t.assigneeId)}</td>
                  <td>{formatDate(t.dueDate)}</td>
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
      {!failed && !data ? <StateMessage kind="loading" /> : null}
    </>
  );
}
