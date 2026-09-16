#!/usr/bin/env node
// Bumps the patch version in every package.json / manifest.json that carries
// a project version, keeping them in sync. Prints the new version on stdout.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const targets = [
  "package.json",
  "common/package.json",
  "mcp-server/package.json",
  "mcp-server/manifest.json",
  "chrome-extension/package.json",
  "chrome-extension/manifest.json",
  "firefox-extension/package.json",
  "firefox-extension/manifest.json",
];

const currentVersion = JSON.parse(
  readFileSync(join(rootDir, "package.json"), "utf8"),
).version;

const parts = currentVersion.split(".").map(Number);
if (parts.length !== 3 || parts.some(Number.isNaN)) {
  throw new Error(`Unexpected version format in root package.json: ${currentVersion}`);
}
const [major, minor, patch] = parts;
const nextVersion = `${major}.${minor}.${patch + 1}`;

for (const relPath of targets) {
  const filePath = join(rootDir, relPath);
  const original = readFileSync(filePath, "utf8");
  const versionLinePattern = /"version"\s*:\s*"[^"]*"/;
  if (!versionLinePattern.test(original)) {
    throw new Error(`No "version" field found in ${relPath}`);
  }
  const updated = original.replace(versionLinePattern, `"version": "${nextVersion}"`);
  writeFileSync(filePath, updated);
}

console.log(nextVersion);
