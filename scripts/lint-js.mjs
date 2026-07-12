import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const roots = ["graphrag_pipeline/static/app/js", "tests/e2e"];
const files = roots.flatMap((root) => {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:js|mjs)$/.test(entry.name))
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
});

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`JavaScript syntax check passed: ${files.length} files`);
