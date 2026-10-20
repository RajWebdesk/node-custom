"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest, isManager, type AssignableUser, type Me, type Task } from "../lib/api";
import { StateMessage } from "./StateMessage";
import { TaskForm } from "./TaskForm";

// New task page (Task #7.2). Only managers and administrators can reach it; the API refuses others anyway.

export function TaskNew() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AssignableUser[] | null>(null);

  useEffect(() => {
    apiRequest("/api/v1/me").then(async (res) => {
      if (!res.ok) return setAllowed(false);
      const me = (await res.json()) as Me;
      setAllowed(isManager(me.roles));
    });
  }, []);

  useEffect(() => {
    if (allowed !== true) return;
    apiRequest("/api/v1/directory/users").then(async (res) => {
      if (res.ok) setUsers(((await res.json()) as { users: AssignableUser[] }).users);
      else setUsers([]);
    });
  }, [allowed]);

  if (allowed === null || (allowed && users === null)) return <StateMessage kind="loading" />;
  if (!allowed) return <StateMessage kind="no-access" />;

  return <TaskForm users={users ?? []} onSaved={(task: Task) => router.push(`/tasks/${task.id}`)} />;
}
