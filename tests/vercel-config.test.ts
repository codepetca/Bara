import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
  git?: {
    deploymentEnabled?: Record<string, boolean>;
  };
};

describe("Vercel deployment configuration", () => {
  it("deploys only main and production, including for slash-containing feature branches", () => {
    expect(vercel.git?.deploymentEnabled).toEqual({
      main: true,
      production: true,
      "**": false,
    });
  });
});
