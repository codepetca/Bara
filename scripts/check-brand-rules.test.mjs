import { describe, expect, it } from "vitest";
import { containsGuardedName } from "./check-brand-rules.mjs";

describe("containsGuardedName", () => {
  const guardedNames = ["Bara", "Tapcheck"];

  it("detects product names in JSX text nodes", () => {
    expect(containsGuardedName("<span>Bara</span>", guardedNames)).toBe(true);
  });

  it("detects product names in template literals", () => {
    expect(containsGuardedName("const title = `Welcome to Bara`;", guardedNames)).toBe(true);
  });

  it("allows references through the shared brand configuration", () => {
    expect(containsGuardedName("<span>{brand.name}</span>", guardedNames)).toBe(false);
  });

  it.each(["baracuda", "fooBara", "tapchecklist"])(
    "allows incidental text containing %s",
    (source) => {
      expect(containsGuardedName(source, guardedNames)).toBe(false);
    },
  );
});
