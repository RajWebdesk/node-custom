"use client";

import { useEffect, useState } from "react";
import { apiRequest, FREE_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from "./api";

// Configured status and priority lists (Task #13.3). The built-in values are the starting point, so the
// board and forms still work while the list request is in flight or if it fails.
export interface TaskLists {
  statuses: string[];
  free: string[]; // statuses a manager or administrator can move between directly
  priorities: string[];
}

const WORKFLOW = ["In Review", "Approved", "Revision requested"];

const DEFAULTS: TaskLists = {
  statuses: [...TASK_STATUSES],
  free: [...FREE_STATUSES],
  priorities: [...TASK_PRIORITIES],
};

export function listsFrom(body: { statuses: { value: string }[]; priorities: string[] }): TaskLists {
  const statuses = body.statuses.map((s) => s.value);
  return { statuses, free: statuses.filter((s) => !WORKFLOW.includes(s)), priorities: body.priorities };
}

export function useTaskLists(): TaskLists {
  const [lists, setLists] = useState<TaskLists>(DEFAULTS);
  useEffect(() => {
    let active = true;
    apiRequest("/api/v1/task-lists")
      .then(async (res) => {
        if (!res.ok || !active) return;
        setLists(listsFrom((await res.json()) as { statuses: { value: string }[]; priorities: string[] }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return lists;
}
