import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
    private readonly pool: Pool;

    constructor(config: ConfigService) {
        // A bare connection string makes @prisma/adapter-pg build a `pg.Pool`
        // with the driver's defaults, including idleTimeoutMillis: 10000 —
        // every gap of >10s between requests (completely normal between
        // dashboard page loads) drops the pooled connection, and Neon's
        // serverless compute suspends when idle, so the next query pays a
        // ~3s wake-from-suspend cost establishing a fresh one (measured:
        // 6 concurrent fresh connections all took ~2.9-3.0s to acquire,
        // vs. ~275ms once warm). Passing our own long-lived Pool instead
        // keeps connections open across the gaps between page loads,
        // which is the only thing code here can do about compute-suspend
        // latency — it can't prevent suspension itself (that's a Neon
        // project setting), only reduce how often a request pays for it.
        const pool = new Pool({ connectionString: config.getOrThrow<string>("DATABASE_URL"), max: 10, idleTimeoutMillis: 0 });
        super({ adapter: new PrismaPg(pool) });
        this.pool = pool;
    }

    async onModuleDestroy() {
        await this.$disconnect();
        await this.pool.end();
    }
}
