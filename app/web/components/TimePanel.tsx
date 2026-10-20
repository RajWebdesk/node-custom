"use client";

import { useCallback, useEffect, useState } from "react";
import { ADJUST_MODES, apiRequest, errorCode, errorText, isManager, type Me } from "../lib/api";
import { StateMessage } from "./StateMessage";

// Planned time allocation (Task #8.3). Allocated time is planned time, not time worked.
// Only administrators change it. The API enforces that; this page hides the controls for everyone else.

interface AllocationItem {
  subjectId: string;
  name: string;
  plannedHours: number | null;
  updatedAt: string | null;
}

interface HistoryItem {
  at: string;
  actorName: string;
  previousHours: number;
  newHours: number;
  delta: number;
  reason: string | null;
}

const MODE_LABELS: Record<(typeof ADJUST_MODES)[number], string> = {
  set: "Set to",
  increase: "Increase by",
  decrease: "Decrease by",
};

function formatHours(value: number | null): string {
  return value === null ? "Not set" : `${value} h`;
}

export function TimePanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<AllocationItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [mode, setMode] = useState<(typeof ADJUST_MODES)[number]>("set");
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const admin = me ? me.roles.includes("ADMINISTRATOR") : false;

  const loadItems = useCallback(async () => {
    try {
      const res = await apiRequest("/api/v1/allocations");
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setItems(((await res.json()) as { items: AllocationItem[] }).items);
    } catch {
      setFailed(true);
    }
  }, []);

  const loadHistory = useCallback(async (subjectId: string) => {
    if (!subjectId) return;
    const res = await apiRequest(`/api/v1/allocations/${encodeURIComponent(subjectId)}/history`);
    setHistory(res.ok ? ((await res.json()) as { items: HistoryItem[] }).items : []);
  }, []);

  useEffect(() => {
    apiRequest("/api/v1/me").then(async (res) => {
      if (res.ok) setMe((await res.json()) as Me);
    });
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!selected && items && items.length > 0) setSelected(items[0].subjectId);
  }, [items, selected]);

  useEffect(() => {
    void loadHistory(selected);
  }, [selected, loadHistory]);

  async function onAdjust(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const value = Number(hours);
    if (hours.trim() === "" || !Number.isFinite(value)) {
      setMessage({ kind: "error", text: "Enter the hours as a number, for example 7.5." });
      return;
    }
    setSaving(true);
    try {
      const res = await apiRequest(`/api/v1/admin/allocations/${encodeURIComponent(selected)}/adjust`, {
        method: "POST",
        body: { mode, hours: value, reason: reason.trim() || null },
      });
      if (res.ok) {
        const body = (await res.json()) as { previousHours: number; newHours: number; delta: number };
        setMessage({ kind: "ok", text: `Planned hours changed from ${body.previousHours} to ${body.newHours} (${body.delta >= 0 ? "+" : ""}${body.delta}).` });
        setHours("");
        setReason("");
        await Promise.all([loadItems(), loadHistory(selected)]);
        return;
      }
      const code = await errorCode(res);
      // Another change landed first, so reload to show the current value.
      if (code === "stale-allocation") await Promise.all([loadItems(), loadHistory(selected)]);
      setMessage({ kind: "error", text: errorText(code) });
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server. Try again later." });
    } finally {
      setSaving(false);
    }
  }

  if (failed) return <StateMessage kind="error" />;
  if (!me || !items) return <StateMessage kind="loading" />;

  const subject = items.find((i) => i.subjectId === selected);

  return (
    <>
      <p className="kpi-label">
        Allocated time is planned time, not time worked. {admin ? "You can change it." : isManager(me.roles) ? "Managers can view allocations. Only administrators change them." : "You can see your own allocation. Only administrators change it."}
      </p>

      {items.length === 0 ? <StateMessage kind="empty" /> : null}

      {items.length > 0 ? (
        <div className="card table-wrap">
          <table>
            <caption>Planned allocation</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Planned hours</th>
                <th scope="col">Last changed</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.subjectId}>
                  <td>
                    <button type="button" className="link-button" onClick={() => setSelected(i.subjectId)} aria-pressed={selected === i.subjectId}>
                      {i.name}
                    </button>
                  </td>
                  <td>{formatHours(i.plannedHours)}</td>
                  <td>{i.updatedAt ? i.updatedAt.slice(0, 10) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {admin && subject ? (
        <form className="card" onSubmit={onAdjust} aria-label={`Change planned hours for ${subject.name}`}>
          <h2>Change planned hours for {subject.name}</h2>
          <div className="field">
            <label htmlFor="adjust-mode">Change</label>
            <select id="adjust-mode" value={mode} onChange={(e) => setMode(e.target.value as (typeof ADJUST_MODES)[number])}>
              {ADJUST_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="adjust-hours">Hours (up to two decimal places)</label>
            <input id="adjust-hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="adjust-reason">Reason (optional)</label>
            <input id="adjust-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <button className="button" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save change"}
          </button>
        </form>
      ) : null}

      {message ? (
        <div className={message.kind === "ok" ? "state state-empty" : "state state-error"} role={message.kind === "ok" ? "status" : "alert"}>
          <p>{message.text}</p>
        </div>
      ) : null}

      {subject && history ? (
        <div className="card table-wrap">
          <table>
            <caption>History for {subject.name}. Newest first.</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Changed by</th>
                <th scope="col">Previous</th>
                <th scope="col">New</th>
                <th scope="col">Change</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={6}>No changes yet.</td>
                </tr>
              ) : null}
              {history.map((h, i) => (
                <tr key={`${h.at}-${i}`}>
                  <td>{h.at.slice(0, 16).replace("T", " ")}</td>
                  <td>{h.actorName}</td>
                  <td>{h.previousHours} h</td>
                  <td>{h.newHours} h</td>
                  <td>{h.delta >= 0 ? `+${h.delta}` : h.delta} h</td>
                  <td>{h.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
