-- Configurable task status and priority lists (pilot interim values, decision 2026-10-21).
CREATE TABLE "TaskListItem" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "protected" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskListItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskListItem_kind_value_key" ON "TaskListItem"("kind", "value");

-- Workflow-critical statuses are protected: the approval workflow and the default status depend on them.
INSERT INTO "TaskListItem" ("id", "kind", "value", "protected", "position") VALUES
    ('seed-status-todo', 'status', 'To Do', true, 0),
    ('seed-status-inprogress', 'status', 'In Progress', true, 1),
    ('seed-status-inreview', 'status', 'In Review', true, 2),
    ('seed-status-approved', 'status', 'Approved', true, 3),
    ('seed-status-revision', 'status', 'Revision requested', true, 4),
    ('seed-priority-low', 'priority', 'Low', false, 0),
    ('seed-priority-medium', 'priority', 'Medium', false, 1),
    ('seed-priority-high', 'priority', 'High', false, 2);
