import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthService } from "./auth.service.js";
import { AuthController } from "./auth.controller.js";

@Module({
    imports: [
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                secret: config.getOrThrow<string>("SESSION_JWT_SECRET"),
            }),
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService],
    exports: [AuthService], // SessionAuthGuard (in common/) needs this
})
export class AuthModule {}
