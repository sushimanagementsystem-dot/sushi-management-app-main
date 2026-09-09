// Prisma 7 config — CLI-side connection (migrate, studio, db seed) and
// the seed command. Runtime connections (NestJS app) go through the
// driver adapter passed to `new PrismaClient({ adapter })` instead —
// see src/import/import.service.ts / prisma/seed.ts.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
    schema: "prisma/schema.prisma",
    datasource: {
        url: env("DATABASE_URL"),
    },
    migrations: {
        seed: "tsx prisma/seed.ts",
    },
});
