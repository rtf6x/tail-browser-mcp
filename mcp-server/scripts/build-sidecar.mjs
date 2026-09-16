#!/usr/bin/env node
// Builds mcp-server into a single self-contained native executable using
// Node's built-in Single Executable Application (SEA) support, so the
// desktop-app Tauri sidecar can spawn it without requiring Node.js to be
// installed on the end user's machine.
//
// Usage: node scripts/build-sidecar.mjs <rust-target-triple> <output-dir>
// Example: node scripts/build-sidecar.mjs aarch64-apple-darwin ../desktop-app/src-tauri/binaries
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mcpServerDir = dirname(dirname(fileURLToPath(import.meta.url)));
const [targetTriple, outDirArg] = process.argv.slice(2);

if (!targetTriple || !outDirArg) {
  console.error("Usage: node scripts/build-sidecar.mjs <rust-target-triple> <output-dir>");
  process.exit(1);
}

const outDir = join(mcpServerDir, outDirArg);
mkdirSync(outDir, { recursive: true });

const buildDir = join(mcpServerDir, ".sidecar-build");
rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });

const bundlePath = join(buildDir, "bundle.cjs");
const seaConfigPath = join(buildDir, "sea-config.json");
const blobPath = join(buildDir, "sea-prep.blob");

console.log(`[sidecar] bundling mcp-server for ${targetTriple}...`);
execFileSync(
  "npx",
  [
    "esbuild",
    "http-server.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--target=node22",
    `--outfile=${bundlePath}`,
  ],
  { cwd: mcpServerDir, stdio: "inherit" }
);

writeFileSync(
  seaConfigPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    },
    null,
    2
  )
);

console.log("[sidecar] generating SEA blob...");
execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPath], {
  cwd: buildDir,
  stdio: "inherit",
});

const isWindows = targetTriple.includes("windows");
const exeName = `mcp-server-${targetTriple}${isWindows ? ".exe" : ""}`;
const outExePath = join(outDir, exeName);

console.log(`[sidecar] copying node executable to ${outExePath}...`);
copyFileSync(process.execPath, outExePath);

if (process.platform === "darwin") {
  execFileSync("codesign", ["--remove-signature", outExePath], { stdio: "inherit" });
} else if (isWindows) {
  try {
    execFileSync("signtool", ["remove", "/s", outExePath], { stdio: "ignore" });
  } catch {
    // No existing signature to strip; safe to ignore.
  }
}

console.log("[sidecar] injecting blob with postject...");
const postjectArgs = [
  "postject",
  outExePath,
  "NODE_SEA_BLOB",
  blobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
];
if (process.platform === "darwin") {
  postjectArgs.push("--macho-segment-name", "NODE_SEA");
}
execFileSync("npx", postjectArgs, { cwd: mcpServerDir, stdio: "inherit" });

if (process.platform === "darwin") {
  execFileSync("codesign", ["--sign", "-", outExePath], { stdio: "inherit" });
}

rmSync(buildDir, { recursive: true, force: true });
console.log(`[sidecar] built ${outExePath}`);
