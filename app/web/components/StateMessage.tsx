// Shared state messages. The registry's standard states: empty, loading, error, no-access, read-only.
// Each message names the state and gives a next step. Never shows raw error detail.

type StateKind = "empty" | "loading" | "error" | "no-access" | "read-only";

const COPY: Record<StateKind, { title: string; className: string }> = {
  empty: { title: "Nothing to show yet.", className: "state state-empty" },
  loading: { title: "Loading…", className: "state state-empty" },
  error: { title: "Something went wrong. Try again later.", className: "state state-error" },
  "no-access": { title: "You do not have access to this area.", className: "state state-error" },
  "read-only": { title: "You can view this, but not change it.", className: "state state-empty" },
};

export function StateMessage({ kind, detail }: { kind: StateKind; detail?: string }) {
  const copy = COPY[kind];
  return (
    <div className={copy.className} role={kind === "error" || kind === "no-access" ? "alert" : "status"}>
      <p>{copy.title}</p>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}
