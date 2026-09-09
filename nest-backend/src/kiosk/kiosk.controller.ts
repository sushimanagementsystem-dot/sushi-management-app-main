import { Controller, Post, UseGuards } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator.js";
import { KioskTokenGuard } from "../common/guards/kiosk-token.guard.js";
import { CurrentKiosk } from "../common/decorators/current-kiosk.decorator.js";
import type { Kiosk } from "@prisma/client";

// Kiosk identity comes from the secret `token` baked into the kiosk's URL
// link — no session required at this point (staff haven't signed in yet).
// See KioskTokenGuard and CLAUDE.md's Auth model.
@Controller()
export class KioskController {
    @Public()
    @UseGuards(KioskTokenGuard)
    @Post("kiosk_info")
    kioskInfo(@CurrentKiosk() kiosk: Kiosk) {
        // Nested under `kiosk`, not flat — matches the old backend's exact
        // wire shape ({ ok: true, kiosk: { kiosk_id, name } }), which
        // KioskHomeContent.js (boot.kiosk.name) and every kiosk page relies
        // on. A flat shape here silently breaks the entire kiosk-facing
        // app: boot.kiosk is always undefined, so every kiosk's home menu
        // renders "Invalid kiosk link" regardless of token validity.
        return { kiosk: { kiosk_id: kiosk.kiosk_id, name: kiosk.name, brand_id: kiosk.brand_id } };
    }
}
