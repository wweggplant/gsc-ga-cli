import { execFileSync } from "node:child_process";

const compiledModules = [
  "dist/cli.js",
  "dist/config/runtime.js",
  "dist/config/sites.js",
  "dist/connectors/clarity.js",
  "dist/connectors/ga4.js",
  "dist/connectors/google.js",
  "dist/connectors/gsc.js",
  "dist/domain/channels.js",
  "dist/domain/constants.js",
  "dist/domain/funnel.js",
  "dist/domain/insights.js",
  "dist/domain/metrics.js",
  "dist/domain/opportunities.js",
  "dist/domain/qa.js",
  "dist/report/markdown.js",
  "dist/shared/dates.js",
  "dist/shared/errors.js",
  "dist/shared/logger.js"
];
const allowed = new Set([
  ".env.example",
  "LICENSE",
  "README.md",
  "config/sites.example.json",
  "package.json",
  ...compiledModules
]);

const output = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const pack = JSON.parse(output)[0];
const paths = pack.files.map((file) => file.path).sort();
const unexpected = paths.filter((file) => !allowed.has(file));
const missing = [...allowed].filter((file) => !paths.includes(file));

if (unexpected.length || missing.length) {
  if (unexpected.length) console.error(`Unexpected package contents:\n${unexpected.join("\n")}`);
  if (missing.length) console.error(`Missing package contents:\n${missing.join("\n")}`);
  process.exit(1);
}

console.log(`Package allowlist passed: ${paths.length} exact files, ${pack.size} bytes packed.`);
