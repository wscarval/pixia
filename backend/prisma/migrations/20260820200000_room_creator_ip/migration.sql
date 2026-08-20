-- AlterTable
ALTER TABLE "rooms" ADD COLUMN "creator_ip" TEXT;

-- CreateIndex
CREATE INDEX "rooms_creator_ip_idx" ON "rooms"("creator_ip");
