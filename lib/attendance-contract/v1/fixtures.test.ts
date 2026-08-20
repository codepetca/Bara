import { describe, expect, it } from "vitest";
import {
  invalidV1EventFixtures,
  invalidV1MessageFixtures,
  validV1EventFixture,
  validV1MessageFixtures,
} from "./fixtures";
import { validateV1Event, validateV1Message } from "./validate";

describe("attendance contract v1 provider fixtures", () => {
  it("accepts every valid message and event fixture", () => {
    for (const fixture of validV1MessageFixtures) {
      expect(validateV1Message(fixture), fixture.message_type).toMatchObject({ ok: true });
    }
    expect(validateV1Event(validV1EventFixture)).toMatchObject({ ok: true });
  });

  it("rejects every invalid fixture", () => {
    for (const fixture of invalidV1MessageFixtures) {
      expect(validateV1Message(fixture.value), fixture.name).toMatchObject({ ok: false });
    }
    for (const fixture of invalidV1EventFixtures) {
      expect(validateV1Event(fixture.value), fixture.name).toMatchObject({ ok: false });
    }
  });
});
