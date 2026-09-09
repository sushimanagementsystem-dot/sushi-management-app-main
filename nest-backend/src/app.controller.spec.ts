import { describe, it, expect } from "vitest";
import { AppController } from "./app.controller.js";

describe("AppController", () => {
  it("health() reports ok", () => {
    const controller = new AppController();
    expect(controller.health()).toEqual({ status: "ok" });
  });
});
