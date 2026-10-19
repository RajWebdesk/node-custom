"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StateMessage } from "../../components/StateMessage";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Status = "idle" | "submitting" | "failed";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.status === 200) {
        const body = (await res.json()) as { csrfToken: string };
        // Prototype: held for the session only. Review storage before production.
        sessionStorage.setItem("csrfToken", body.csrfToken);
        router.push("/");
        return;
      }
      setStatus("failed");
      setMessage(
        res.status === 401
          ? "Email or password is incorrect."
          : "Sign-in is unavailable right now. Try again later.",
      );
    } catch {
      setStatus("failed");
      setMessage("Sign-in is unavailable right now. Try again later.");
    }
  }

  return (
    <>
      <form className="card login-card" onSubmit={onSubmit} aria-describedby="login-note">
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <p id="login-note" className="kpi-label">
          Sign in with your account. Accounts are created by the administrator.
        </p>
        <button className="button" type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {status === "failed" && message ? (
        <div className="login-message">
          <StateMessage kind="error" detail={message} />
        </div>
      ) : null}
    </>
  );
}
