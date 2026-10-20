"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, formatDate } from "../lib/api";
import { StateMessage } from "./StateMessage";

// Role-scoped dashboard (Task #12.2). Each metric links to the list it counts. The API decides what each person sees.

interface Metric {
  key: string;
  label: string;
  value: number | null;
  href: string;
}

interface Recent {
  at: string;
  text: string;
}

export function DashboardPanel() {
  const [data, setData] = useState<{ metrics: Metric[]; recent: Recent[]; today: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiRequest("/api/v1/dashboard")
      .then(async (res) => {
        if (!res.ok) {
          setFailed(true);
          return;
        }
        setData((await res.json()) as { metrics: Metric[]; recent: Recent[]; today: string });
      })
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <StateMessage kind="error" />;
  if (!data) return <StateMessage kind="loading" />;

  return (
    <>
      <p className="kpi-label">Today is {data.today} (America/Toronto).</p>
      <div className="kpi-grid">
        {data.metrics.map((m) => (
          <Link key={m.key} href={m.href} className="card kpi" aria-label={`${m.label}: ${m.value ?? "not set"}`}>
            <span className="kpi-label">{m.label}</span>
            <span className="kpi-value">{m.value ?? "Not set"}</span>
          </Link>
        ))}
      </div>
      <h2>Recent activity</h2>
      {data.recent.length === 0 ? (
        <StateMessage kind="empty" />
      ) : (
        <ul>
          {data.recent.map((r, i) => (
            <li key={`${r.at}-${i}`}>
              {formatDate(r.at)}: {r.text}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
