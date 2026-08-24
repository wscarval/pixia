-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN "user_avatar_id" INTEGER;
ALTER TABLE "chat_messages" ADD COLUMN "user_avatar_url" TEXT;

-- CreateTable
CREATE TABLE "room_bans" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "user_id" TEXT,
    "guest_id" TEXT,
    "banned_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_bans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_bans_room_id_idx" ON "room_bans"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_bans_room_id_user_id_key" ON "room_bans"("room_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_bans_room_id_guest_id_key" ON "room_bans"("room_id", "guest_id");

-- AddForeignKey
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
