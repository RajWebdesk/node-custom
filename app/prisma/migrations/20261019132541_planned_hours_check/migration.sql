ALTER TABLE "Allocation" ADD CONSTRAINT "allocation_planned_hours_nonnegative" CHECK ("plannedHours" >= 0);
