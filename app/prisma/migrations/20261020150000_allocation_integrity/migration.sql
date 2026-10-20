-- Allocation integrity (spec Module 8, Task #8.1): one planned allocation per person; foreign keys to users.
-- CreateIndex
CREATE UNIQUE INDEX "Allocation_subjectId_key" ON "Allocation"("subjectId");

-- CreateIndex
CREATE INDEX "AllocationChange_allocationId_at_idx" ON "AllocationChange"("allocationId", "at");

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationChange" ADD CONSTRAINT "AllocationChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

