"use client";

import { useEffect, useState } from "react";
import {
  apiRequest,
  errorCode,
  errorText,
  fromIsoDate,
  toIsoDate,
  type AssignableUser,
  type Task,
} from "../lib/api";
import { StateMessage } from "./StateMessage";
import { useTaskLists } from "../lib/use-task-lists";

// Create and edit form for a task (Task #7.2). The API validates everything; the checks here only give quick feedback.

export function TaskForm({
  task,
  users,
  onSaved,
}: {
  task?: Task;
  users: AssignableUser[];
  onSaved: (saved: Task) => void;
}) {
  const lists = useTaskLists();
  const editing = Boolean(task);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<string>(task?.priority ?? "Medium");
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? "");
  const [reviewerId, setReviewerId] = useState(task?.reviewerId ?? "");
  const [startDate, setStartDate] = useState(fromIsoDate(task?.startDate ?? null));
  const [dueDate, setDueDate] = useState(fromIsoDate(task?.dueDate ?? null));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const reviewers = users.filter((u) => u.isDesignatedReviewer);

  // Preselect the first assignee and reviewer once the user list arrives.
  useEffect(() => {
    if (editing) return;
    const firstReviewer = users.find((u) => u.isDesignatedReviewer);
    if (!assigneeId && users.length > 0) setAssigneeId(users[0].id);
    if (!reviewerId && firstReviewer) setReviewerId(firstReviewer.id);
    // Only when the list arrives; the selections are then the user's to change.
  }, [users, editing]);

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!title.trim()) errors.title = "Enter a title.";
    if (title.trim().length > 200) errors.title = "Use 200 characters or fewer.";
    if (description.length > 5000) errors.description = "Use 5000 characters or fewer.";
    if (!editing && !assigneeId) errors.assigneeId = "Choose an assignee.";
    if (!editing && !reviewerId) errors.reviewerId = "Choose a designated reviewer.";
    if (startDate && dueDate && dueDate < startDate) errors.dueDate = "The due date cannot be before the start date.";
    return errors;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const common = {
      title: title.trim(),
      description: description.trim() === "" ? null : description.trim(),
      priority,
      startDate: toIsoDate(startDate),
      dueDate: toIsoDate(dueDate),
    };
    setSaving(true);
    try {
      const res = editing
        ? await apiRequest(`/api/v1/tasks/${task!.id}`, {
            method: "PATCH",
            body: { ...common, assigneeId },
          })
        : await apiRequest("/api/v1/tasks", {
            method: "POST",
            body: { ...common, assigneeId, reviewerId },
          });
      if (res.ok) {
        onSaved((await res.json()) as Task);
        return;
      }
      setMessage(errorText(await errorCode(res)));
    } catch {
      setMessage("Could not reach the server. Try again later.");
    } finally {
      setSaving(false);
    }
  }

  const assigneeName = (id: string) => users.find((u) => u.id === id)?.name ?? "Assigned user";

  return (
    <form className="card" onSubmit={onSubmit} aria-label={editing ? "Edit task" : "New task"} noValidate>
      <div className="field">
        <label htmlFor="task-title">Title</label>
        <input id="task-title" value={title} maxLength={400} onChange={(e) => setTitle(e.target.value)} aria-invalid={Boolean(fieldErrors.title)} aria-describedby={fieldErrors.title ? "task-title-error" : undefined} />
        {fieldErrors.title ? <p id="task-title-error" role="alert">{fieldErrors.title}</p> : null}
      </div>
      <div className="field">
        <label htmlFor="task-description">Description</label>
        <textarea id="task-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        {fieldErrors.description ? <p role="alert">{fieldErrors.description}</p> : null}
      </div>
      <div className="field">
        <label htmlFor="task-priority">Priority</label>
        <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {lists.priorities.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="task-assignee">Assignee</label>
        <select id="task-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-invalid={Boolean(fieldErrors.assigneeId)}>
          {!editing ? <option value="">Choose a person</option> : null}
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        {fieldErrors.assigneeId ? <p role="alert">{fieldErrors.assigneeId}</p> : null}
      </div>
      <div className="field">
        <label htmlFor="task-reviewer">Designated reviewer</label>
        {editing ? (
          <p id="task-reviewer">{assigneeName(task!.reviewerId)} (set when the task is created)</p>
        ) : (
          <select id="task-reviewer" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} aria-invalid={Boolean(fieldErrors.reviewerId)}>
            <option value="">Choose a reviewer</option>
            {reviewers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        {fieldErrors.reviewerId ? <p role="alert">{fieldErrors.reviewerId}</p> : null}
      </div>
      <div className="field">
        <label htmlFor="task-start">Start date</label>
        <input id="task-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="task-due">Due date</label>
        <input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-invalid={Boolean(fieldErrors.dueDate)} />
        {fieldErrors.dueDate ? <p role="alert">{fieldErrors.dueDate}</p> : null}
      </div>
      <button className="button" type="submit" disabled={saving}>
        {saving ? "Saving…" : editing ? "Save changes" : "Create task"}
      </button>
      {message ? <div className="state state-error" role="alert"><p>{message}</p></div> : null}
      {users.length === 0 ? <StateMessage kind="empty" detail="No active users are available to assign yet." /> : null}
    </form>
  );
}
