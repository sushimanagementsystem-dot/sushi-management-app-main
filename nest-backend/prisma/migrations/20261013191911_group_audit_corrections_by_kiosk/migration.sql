-- AlterTable
ALTER TABLE "audit_correction" ADD COLUMN     "owner_action_id" TEXT;

-- CreateIndex
CREATE INDEX "audit_correction_owner_action_id_idx" ON "audit_correction"("owner_action_id");

-- AddForeignKey
ALTER TABLE "audit_correction" ADD CONSTRAINT "audit_correction_owner_action_id_fkey" FOREIGN KEY ("owner_action_id") REFERENCES "owner_action"("owner_action_id") ON DELETE SET NULL ON UPDATE CASCADE;
