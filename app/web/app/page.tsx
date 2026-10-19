import { Shell } from "../components/Shell";
import { StateMessage } from "../components/StateMessage";
import { mockKpis, mockTasks } from "../lib/mock";

export default function DashboardPage() {
  return (
    <Shell current="Dashboard">
      <h1>Dashboard</h1>

      <section aria-labelledby="kpi-heading">
        <h2 id="kpi-heading">Summary</h2>
        <div className="kpi-grid">
          {mockKpis.map((kpi) => (
            <div className="card" key={kpi.label}>
              <div className="kpi-value">{kpi.value}</div>
              <div className="kpi-label">{kpi.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="tasks-heading">
        <h2 id="tasks-heading">Tasks needing attention</h2>
        <div className="card table-wrap">
          {mockTasks.length === 0 ? (
            <StateMessage kind="empty" />
          ) : (
            <table>
              <caption>Mock data. Sample rows only.</caption>
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Status</th>
                  <th scope="col">Due</th>
                  <th scope="col" className="num">
                    Planned h
                  </th>
                </tr>
              </thead>
              <tbody>
                {mockTasks.map((task) => (
                  <tr key={task.title}>
                    <td>{task.title}</td>
                    <td>
                      <span className="badge">{task.status}</span>
                    </td>
                    <td>{task.due}</td>
                    <td className="num">{task.plannedHours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </Shell>
  );
}
