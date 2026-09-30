import { describe, expect, it } from "vitest";
import { parseDecommissionRequest, parseDecommissionReceipt } from "./decommission";

const request = {
  schema_version: 1, message_type: "roster.decommission", action: "begin",
  installation_ref: "installation_one", roster_ref: "roster_one",
  operation_ref: "decommission_0123456789abcdef0123456789abcdef",
  actor_principal_ref: "principal_teacher",
};
describe("decommission boundary", () => {
  it("accepts only the closed versioned envelope", () => {
    expect(parseDecommissionRequest(request)).toEqual(request);
    for (const change of [{ schema_version: 2 }, { email: "student@example.test" },
      { action: "erase_all" }, { roster_ref: "../all" }, { operation_ref: "short" },
      { actor_principal_ref: "" }]) {
      expect(parseDecommissionRequest({ ...request, ...change })).toBeNull();
    }
  });
  it("requires authoritative absence and binds receipt to the operation", () => {
    const receipt = { schema_version: 1, ok: true, installation_ref: request.installation_ref,
      roster_ref: request.roster_ref, operation_ref: request.operation_ref,
      state: "deleted", absence_verified: true, deleted_count: 7 };
    expect(parseDecommissionReceipt(receipt, request)).toEqual(receipt);
    for (const change of [{ absence_verified: false }, { state: "deleting" },
      { roster_ref: "other" }, { installation_ref: "other" },
      { operation_ref: "decommission_ffffffffffffffffffffffffffffffff" },
      { deleted_count: -1 }, { names: ["Student"] }]) {
      expect(parseDecommissionReceipt({ ...receipt, ...change }, request)).toBeNull();
    }
    expect(parseDecommissionReceipt({ ...receipt, state: "deleting", absence_verified: false }, request))
      .not.toBeNull();
  });
});
