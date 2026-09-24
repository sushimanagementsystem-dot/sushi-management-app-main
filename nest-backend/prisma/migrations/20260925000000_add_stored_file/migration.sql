-- CreateTable
CREATE TABLE "stored_file" (
    "file_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "name" TEXT,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_file_pkey" PRIMARY KEY ("file_id")
);
