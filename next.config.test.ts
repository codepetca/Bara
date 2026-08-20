import { afterEach, describe, expect, it } from "vitest";
import { getAllowedDevOrigins } from "./next.config";

const originalAllowedDevOrigins = process.env.NEXT_ALLOWED_DEV_ORIGINS;

afterEach(() => {
  if (originalAllowedDevOrigins === undefined) {
    delete process.env.NEXT_ALLOWED_DEV_ORIGINS;
  } else {
    process.env.NEXT_ALLOWED_DEV_ORIGINS = originalAllowedDevOrigins;
  }
});

describe("getAllowedDevOrigins", () => {
  it("allows the loopback host used by the shared Pika and Bara smoke test", () => {
    delete process.env.NEXT_ALLOWED_DEV_ORIGINS;

    expect(getAllowedDevOrigins()).toContain("127.0.0.1");
  });

  it("keeps explicitly configured development origins", () => {
    process.env.NEXT_ALLOWED_DEV_ORIGINS = "pika.local, bara.local";

    expect(getAllowedDevOrigins()).toEqual(expect.arrayContaining(["pika.local", "bara.local"]));
  });
});
