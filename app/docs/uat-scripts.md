# User acceptance scripts (Task #16.1)

For AS (designated reviewer), Hazel (Project Manager), and the Administrator. Each script is a sequence of steps and the result to check. Run them on a local instance with test accounts; never on real client data.

The browser suite (`e2e/journeys.spec.ts`) runs scripted versions of these journeys. It proves the paths work. It does not replace this UAT: the people named above run these scripts and record their own results.

## Administrator
1. Sign in. Open **Users**. Add a person with name, email, and role. Expect: "User created."
2. On that person's row, select **Issue reset token**. Expect: a token shown once, with an expiry time. Give it to the person through a secure channel.
3. As the person: open **I have a reset token** (sign-in page). Enter the token and a new password of 12 or more characters. Expect: back to sign-in.
4. The person signs in with the new password. Expect: the dashboard.
5. Open **Time**. Select a person. Choose **Increase by**, enter 0.5 and a reason. Expect: "Planned hours changed from ... to ..." and the change in the history with your name.
6. Open **Activity**. Filter by "Planned hours changed". Expect: the change, with its details.
7. Open **Settings**. Expect: the approved values, read-only, and the role matrix. Open **Roles**: the same matrix.

## Hazel (Project Manager)
1. Open **Tasks**, select **New task**. Enter a title, assignee, and designated reviewer. Expect: the task page with status To Do.
2. Open the task. Select **Move to In Progress**. Expect: "Status changed to In Progress."
3. Open **Board**. Expect: the task under In Progress. Use **Move to** on the card to move it. Review columns do not accept drops.
4. After the employee submits and AS decides (see below), open the task. Expect: the status and the review history.
5. Open **Reports**. Set a date range. Expect: the grouped counts, the weekly trend (chart and table), planned-time changes, and status changes, all matching the tasks on screen.
6. Open the dashboard. Expect: open tasks, waiting for review, overdue, and unread notifications; each one links to its list.
7. Archive a finished task. Expect: it leaves **Tasks** and appears with "Show archived".

## AS (designated reviewer)
1. Open **Reviews**. Expect: submissions waiting for a decision (only if you are the designated reviewer).
2. Open a submission. Select **Request revision**. Expect: "The task is now Revision requested."
3. Later, open the resubmitted revision. Select **Approve**. Expect: "The task is now Approved."
4. Try to approve your own submission (if you are also the assignee). Expect: refused.
5. Reject a submission. Expect: the task stays In Review; the employee can send a new revision. Confirm this is the behaviour you want (known issues, item 4).
6. Open **Notifications**. Expect: a notification for each submission waiting for you.

## Employee (for checking, not a named UAT role)
1. Sign in. Open **Tasks**: only your own tasks. Open a task and select **Submit for review**. Expect: "Submitted for review."
2. Open **Notifications**: the reviewer's decision. Mark it read.
3. Open **Profile**: change your display name; change your password (you are signed out and must sign in again).

## Sign-off record
For each script, the person records: date, the step where anything differed, and their decision (accept, accept with changes, or reject). Keep the record with the known-issues register.
