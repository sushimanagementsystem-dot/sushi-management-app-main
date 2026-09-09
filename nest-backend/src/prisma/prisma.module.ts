import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

// @Global so every feature module can inject PrismaService without each one
// re-importing PrismaModule — same rationale as Nest's own docs recommend
// for a single shared DB client.
@Global()
@Module({
    providers: [PrismaService],
    exports: [PrismaService],
})
export class PrismaModule {}
