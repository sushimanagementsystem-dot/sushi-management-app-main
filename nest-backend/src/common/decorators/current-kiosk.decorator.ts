import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Kiosk } from "@prisma/client";

// Populated by KioskTokenGuard — only valid on routes that use it.
export const CurrentKiosk = createParamDecorator((_data: unknown, ctx: ExecutionContext): Kiosk => {
    const request = ctx.switchToHttp().getRequest();
    return request.kiosk;
});
