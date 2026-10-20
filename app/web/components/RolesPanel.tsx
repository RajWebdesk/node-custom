"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { StateMessage } from "./StateMessage";

// Roles and permissions (Task #13.4). The matrix comes from the server, so this page and the settings view agree.
interface Matrix {
  roles: { role: string; label: string }[];
  permissionMatrix: { module: string; Administrator: string; Manager: string; Employee: string }[];
}

export function RolesPanel() {
  const [data, setData] = useState<Matrix | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "no-access" | "error">("loading");

  useEffect(() => {
    apiRequest("/api/v1/admin/settings")
      .then(async (res) => {
        if (res.status === 403) return setState("no-access");
        if (!res.ok) return setState("error");
        setData((await res.json()) as Matrix);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  if (state === "loading") return <StateMessage kind="loading" />;
  if (state === "no-access") return <StateMessage kind="no-access" detail="The roles page is for administrators." />;
  if (state === "error" || !data) return <StateMessage kind="error" />;

  return (
    <>
      <p className="kpi-label">Three fixed roles. No custom permission builder (spec Out of Scope).</p>
      <div className="table-wrap card">
        <table>
          <caption>Role-by-module matrix</caption>
          <thead>
            <tr>
              <th scope="col">Module</th>
              {data.roles.map((r) => (
                <th key={r.role} scope="col">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.permissionMatrix.map((row) => (
              <tr key={row.module}>
                <th scope="row">{row.module}</th>
                <td>{row.Administrator}</td>
                <td>{row.Manager}</td>
                <td>{row.Employee}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
