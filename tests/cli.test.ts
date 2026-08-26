import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { run, writePrivateReport } from "../src/cli.js";

const originalCwd = process.cwd();
afterEach(() => process.chdir(originalCwd));

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { out: (v: string) => stdout.push(v), err: (v: string) => stderr.push(v) } };
}

async function validConfig(dir: string): Promise<string> {
  const file = path.join(dir, "config.json");
  await writeFile(file, JSON.stringify({ sites: [{ key: "demo", label: "Demo", gscSiteUrl: "sc-domain:test.invalid", ga4PropertyId: "987654321" }] }));
  return file;
}

describe("CLI", () => {
  it("supports help and version without configuration", async () => {
    const help = capture();
    expect(await run(["--help"], help.io)).toBe(0);
    expect(help.stdout.join("\n")).toContain("gsc-ga <command>");
    const version = capture();
    expect(await run(["--version"], version.io)).toBe(0);
    expect(version.stdout).toEqual(["0.0.1"]);
  });

  it("initializes without overwriting unless forced", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gsc-ga-init-"));
    const first = capture();
    expect(await run(["init", "--dir", dir], first.io)).toBe(0);
    expect(JSON.parse(await readFile(path.join(dir, "gsc-ga.config.json"), "utf8")).sites).toHaveLength(1);
    expect(await run(["init", "--dir", dir], capture().io)).toBe(1);
    expect(await run(["init", "--dir", dir, "--force"], capture().io)).toBe(0);
  });

  it("lists sites as text and JSON", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gsc-ga-sites-"));
    const config = await validConfig(dir);
    const text = capture();
    expect(await run(["sites", "--config", config], text.io)).toBe(0);
    expect(text.stdout[0]).toContain("demo\tDemo");
    const json = capture();
    expect(await run(["sites", "--config", config, "--json"], json.io)).toBe(0);
    expect(JSON.parse(json.stdout[0])[0].key).toBe("demo");
  });

  it("doctor returns nonzero and machine-readable failure without credentials", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gsc-ga-doctor-"));
    const config = await validConfig(dir);
    const old = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const result = capture();
    expect(await run(["doctor", "--config", config, "--json"], result.io)).toBe(1);
    expect(JSON.parse(result.stdout[0]).ok).toBe(false);
    if (old) process.env.GOOGLE_APPLICATION_CREDENTIALS = old;
  });

  it("does not disclose an absolute credential path in doctor JSON", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gsc-ga-doctor-private-"));
    const config = await validConfig(dir);
    const secretPath = path.join(dir, "credentials", "service-account.json");
    const old = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = secretPath;
    try {
      const result = capture();
      expect(await run(["doctor", "--config", config, "--json"], result.io)).toBe(1);
      expect(result.stdout[0]).not.toContain(secretPath);
    } finally {
      if (old === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      else process.env.GOOGLE_APPLICATION_CREDENTIALS = old;
    }
  });

  it("writes report artifacts with private permissions", async () => {
    if (process.platform === "win32") return;
    const dir = await mkdtemp(path.join(os.tmpdir(), "gsc-ga-permissions-"));
    const outputDir = path.join(dir, "private-reports");
    const output = path.join(outputDir, "report.md");
    await writePrivateReport(outputDir, output, "private report");
    expect((await stat(outputDir)).mode & 0o777).toBe(0o700);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
  });

  it("validates report configuration in dry-run without API calls or credentials", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gsc-ga-report-"));
    const config = await validConfig(dir);
    const result = capture();
    expect(await run(["report", "--config", config, "--site", "demo", "--days", "7", "--date-end", "2026-01-31", "--dry-run", "--json"], result.io)).toBe(0);
    const payload = JSON.parse(result.stdout[0]);
    expect(payload.dryRun).toBe(true);
    expect(payload.reports[0].windows.current.endDate).toBe("2026-01-31");
  });
});
