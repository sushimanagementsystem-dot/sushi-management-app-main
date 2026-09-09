import { Module } from "@nestjs/common";
import { KioskController } from "./kiosk.controller.js";

@Module({
    controllers: [KioskController],
})
export class KioskModule {}
