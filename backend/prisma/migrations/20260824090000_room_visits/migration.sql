-- CreateTable
CREATE TABLE "room_visits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "last_visited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_visits_user_id_last_visited_at_idx" ON "room_visits"("user_id", "last_visited_at");

-- CreateIndex
CREATE UNIQUE INDEX "room_visits_user_id_room_id_key" ON "room_visits"("user_id", "room_id");

-- AddForeignKey
ALTER TABLE "room_visits" ADD CONSTRAINT "room_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_visits" ADD CONSTRAINT "room_visits_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
