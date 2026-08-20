import { describe, expect, it } from "vitest";
import { createV1RequestSignature, verifyV1RequestSignature } from "./signing";

const input = {
  secret: "test-integration-secret-with-more-than-32-characters",
  method: "PUT",
  path: "/api/integrations/pika/v1/rosters/roster_one",
  timestamp: "1786917600",
  nonce: "nonce_request_one_12345",
  body: '{"schema_version":1}',
};

describe("attendance contract v1 request signing", () => {
  it("authenticates the exact method, path, timestamp, nonce, and body", async () => {
    const signature = await createV1RequestSignature(input);

    await expect(verifyV1RequestSignature(input, signature)).resolves.toBe(true);
    await expect(verifyV1RequestSignature({ ...input, body: "{}" }, signature)).resolves.toBe(false);
    await expect(verifyV1RequestSignature({ ...input, path: `${input.path}-other` }, signature)).resolves.toBe(false);
  });

  it("rejects malformed signatures and weak secrets", async () => {
    await expect(verifyV1RequestSignature(input, "v1=not-hex")).resolves.toBe(false);
    await expect(createV1RequestSignature({ ...input, secret: "too-short" })).rejects.toThrow(
      "at least 32",
    );
  });
});
