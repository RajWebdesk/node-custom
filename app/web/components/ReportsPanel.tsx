"use client";

import { useEffect, useState } from "react";
import { apiRequest, formatDate } from "../lib/api";
import { StateMessage } from "./StateMessage";

// Reports screens (Task #13.2). Every chart has a table with the same numbers beside it.
// The API applies visibility; this page only shows what it returns.

interface TaskReport {
  total: number;
  overdue: number;
  groups: { key: string; label: string; count: number }[];
  trend: { week: string; created: number; due: number }[] | null;
}
interface TimeReport {
  totals: { subjectId: string; name: string; changes: number; netDelta: number }[];
  changes: { at: string; subjectName: string; actorName: string; previousHours: number; newHours: number; delta: number; reason: string | null }[];
  truncated: boolean;
}
interface HistoryReport {
  items: { at: string; taskTitle: string; fromStatus: string; toStatus: string; actorName: string }[];
  truncated: boolean;
}

const GROUPS = [
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "assignee", label: "Assignee" },
  { value: "overdue", label: "Overdue" },
];

function Bars({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <table className="bar-table">
      <caption>Tasks by group</caption>
      <thead>
        <tr>
          <th scope="col">Group</th>
          <th scope="col">Tasks</th>
          <th scope="col">Chart</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td className="num">{r.count}</td>
            <td>
              <div className="bar" style={{ width: `${Math.round((r.count / max) * 100)}%` }} aria-hidden="true" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Grouped bars for created and due counts per week. Drawn as SVG with the numbers in a table beside it.
function TrendChart({ rows }: { rows: { week: string; created: number; due: number }[] }) {
  const width = 640;
  const height = 220;
  const pad = 32;
  const max = Math.max(1, ...rows.flatMap((r) => [r.created, r.due]));
  const slot = (width - pad * 2) / Math.max(1, rows.length);
  const barW = Math.max(4, slot / 3);
  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tasks created and due per week" width="100%">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="currentColor" />
        {rows.map((r, i) => {
          const x = pad + i * slot;
          const hC = ((height - pad * 2) * r.created) / max;
          const hD = ((height - pad * 2) * r.due) / max;
          return (
            <g key={r.week}>
              <rect x={x + 4} y={height - pad - hC} width={barW} height={hC} fill="var(--accent, #2b5ea7)" />
              <rect x={x + 4 + barW} y={height - pad - hD} width={barW} height={hD} fill="var(--muted, #8aa1c4)" />
            </g>
          );
        })}
      </svg>
      <table>
        <caption>Weekly trend (weeks start Monday). Created and due counts.</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Created</th>
            <th scope="col">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.week}>
              <td>{r.week}</td>
              <td className="num">{r.created}</td>
              <td className="num">{r.due}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function ReportsPanel() {
  const [groupBy, setGroupBy] = useState("status");
  const [dateField, setDateField] = useState("dueDate");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tasks, setTasks] = useState<TaskReport | null>(null);
  const [time, setTime] = useState<TimeReport | null>(null);
  const [history, setHistory] = useState<HistoryReport | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const range = new URLSearchParams();
    if (from) range.set("from", from);
    if (to) range.set("to", to);
    const taskParams = new URLSearchParams(range);
    taskParams.set("groupBy", groupBy);
    taskParams.set("dateField", dateField);
    const suffix = range.toString() ? `?${range.toString()}` : "";

    Promise.all([
      apiRequest(`/api/v1/reports/tasks?${taskParams.toString()}`),
      apiRequest(`/api/v1/reports/time${suffix}`),
      apiRequest(`/api/v1/reports/history${suffix}`),
    ])
      .then(async ([t, tm, h]) => {
        if (!t.ok || !tm.ok || !h.ok) {
          const bad = [t, tm, h].find((r) => !r.ok);
          setFailed(bad?.status === 400 ? "Check the dates: the start must be on or before the end, within two years." : "The reports could not be loaded.");
          return;
        }
        setFailed(null);
        setTasks((await t.json()) as TaskReport);
        setTime((await tm.json()) as TimeReport);
        setHistory((await h.json()) as HistoryReport);
      })
      .catch(() => setFailed("The reports could not be loaded."));
  }, [groupBy, dateField, from, to]);

  return (
    <>
      <form className="card" role="search" aria-label="Report filters" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="rep-group">Group tasks by</label>
          <select id="rep-group" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            {GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rep-field">Date field</label>
          <select id="rep-field" value={dateField} onChange={(e) => setDateField(e.target.value)}>
            <option value="dueDate">Due date</option>
            <option value="createdAt">Created date</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="rep-from">From</label>
          <input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rep-to">To</label>
          <input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <p className="kpi-label">A trend is shown when both dates are set.</p>
      </form>

      {failed ? <div className="state state-error" role="alert"><p>{failed}</p></div> : null}
      {!failed && (!tasks || !time || !history) ? <StateMessage kind="loading" /> : null}

      {tasks && !failed ? (
        <section className="card" aria-label="Task report">
          <h2>Tasks</h2>
          <p>
            {tasks.total} tasks, {tasks.overdue} overdue (open and past due, as of today in America/Toronto).
          </p>
          {tasks.groups.length === 0 ? <StateMessage kind="empty" /> : <Bars rows={tasks.groups} />}
          {tasks.trend ? <TrendChart rows={tasks.trend} /> : null}
        </section>
      ) : null}

      {time && !failed ? (
        <section className="card" aria-label="Planned time report">
          <h2>Planned time changes</h2>
          {time.totals.length === 0 ? (
            <StateMessage kind="empty" detail="No planned-time changes in this range." />
          ) : (
            <table>
              <caption>Net change per person in this range</caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Changes</th>
                  <th scope="col">Net change (hours)</th>
                </tr>
              </thead>
              <tbody>
                {time.totals.map((t) => (
                  <tr key={t.subjectId}>
                    <td>{t.name}</td>
                    <td className="num">{t.changes}</td>
                    <td className="num">{t.netDelta >= 0 ? `+${t.netDelta}` : t.netDelta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {time.changes.length > 0 ? (
            <table>
              <caption>Changes, newest first{time.truncated ? " (first 200 shown)" : ""}</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Person</th>
                  <th scope="col">Changed by</th>
                  <th scope="col">Previous</th>
                  <th scope="col">New</th>
                  <th scope="col">Change</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {time.changes.map((c, i) => (
                  <tr key={`${c.at}-${i}`}>
                    <td>{formatDate(c.at)}</td>
                    <td>{c.subjectName}</td>
                    <td>{c.actorName}</td>
                    <td>{c.previousHours} h</td>
                    <td>{c.newHours} h</td>
                    <td>{c.delta >= 0 ? `+${c.delta}` : c.delta} h</td>
                    <td>{c.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      {history && !failed ? (
        <section className="card" aria-label="Status change history report">
          <h2>Status changes</h2>
          {history.items.length === 0 ? (
            <StateMessage kind="empty" detail="No status changes in this range." />
          ) : (
            <table>
              <caption>Newest first{history.truncated ? " (first 200 shown)" : ""}</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Task</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Changed by</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((h, i) => (
                  <tr key={`${h.at}-${i}`}>
                    <td>{formatDate(h.at)}</td>
                    <td>{h.taskTitle}</td>
                    <td>{h.fromStatus}</td>
                    <td>{h.toStatus}</td>
                    <td>{h.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </>
  );
}
