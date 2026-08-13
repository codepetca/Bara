import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { containsGuardedName } from "./check-brand-rules.mjs";

const root = process.cwd();
const brandConfigPath = path.join(root, "config", "brand.ts");
const brandSource = await readFile(brandConfigPath, "utf8");
const brandName = brandSource.match(/name:\s*"([^"]+)"/)?.[1];
const formerNamesSource = brandSource.match(/formerNames:\s*(\[[\s\S]*?\])/)?.[1];

if (!brandName || !formerNamesSource) {
  throw new Error("Could not read the product-name configuration from config/brand.ts.");
}

const guardedNames = [brandName, ...JSON.parse(formerNamesSource)].map((name) =>
  name.toLocaleLowerCase(),
);

const sourceRoots = ["app", "components", "convex", "lib"];
const allowedFiles = new Set([path.relative(root, brandConfigPath)]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const violations = [];

async function visit(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      await visit(relativePath);
      continue;
    }

    if (!sourceExtensions.has(path.extname(entry.name)) || allowedFiles.has(relativePath)) {
      continue;
    }

    const source = await readFile(path.join(root, relativePath), "utf8");
    const lines = source.split("\n");

    lines.forEach((line, index) => {
      if (containsGuardedName(line, guardedNames)) {
        violations.push(`${relativePath}:${index + 1}`);
      }
    });
  }
}

for (const sourceRoot of sourceRoots) {
  await visit(sourceRoot);
}

if (violations.length > 0) {
  console.error(
    `Hardcoded current or former product-name literals found outside config/brand.ts:\n${violations.join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(`Brand check passed: ${brandName} and former names are centralized in config/brand.ts.`);
}
