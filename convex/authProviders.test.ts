import { afterEach, describe, expect, it } from "vitest";
import { getAuthProvider } from "./authProviders";

const originalProviderMap = process.env.TAPCHECK_AUTH_PROVIDER_ISSUER_MAP;
const originalWorkosClientId = process.env.WORKOS_CLIENT_ID;

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe("auth provider resolution", () => {
  afterEach(() => {
    restoreEnv("TAPCHECK_AUTH_PROVIDER_ISSUER_MAP", originalProviderMap);
    restoreEnv("WORKOS_CLIENT_ID", originalWorkosClientId);
  });

  it("uses explicit issuer maps before issuer heuristics", () => {
    process.env.TAPCHECK_AUTH_PROVIDER_ISSUER_MAP = "shared_identity=https://login.example.com";

    expect(
      getAuthProvider({
        issuer: "https://login.example.com/",
        subject: "user_1",
      }),
    ).toBe("shared_identity");
  });

  it("treats the configured WorkOS client issuer as WorkOS", () => {
    process.env.WORKOS_CLIENT_ID = "client_test";

    expect(
      getAuthProvider({
        issuer: "https://api.workos.com/user_management/client_test",
        subject: "user_1",
      }),
    ).toBe("workos");
  });
});
