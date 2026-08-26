#!/usr/bin/env node
import { access, chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadDotEnv, getRuntimeEnv, validateCredentials, type AppEnv } from "./config/runtime.js";
import { getSiteByKey, loadSites, resolveConfigPath, type SiteConfig } from "./config/sites.js";
import { fetchClarityWindowReport } from "./connectors/clarity.js";
import { fetchGa4WindowReport } from "./connectors/ga4.js";
import { fetchGscWindowReport } from "./connectors/gsc.js";
import { buildInsights } from "./domain/insights.js";
import { detectOpportunities } from "./domain/opportunities.js";
import { renderReportMarkdown } from "./report/markdown.js";
import { buildComparisonWindows } from "./shared/dates.js";
import { AppError, formatError, toAppError } from "./shared/errors.js";

const VERSION = "0.0.1";
const EXECUTABLE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(EXECUTABLE_DIR, "..");

type FlagValue = string | boolean;
interface ParsedArgs { command?: string; flags: Map<string, FlagValue> }

export async function run(argv: string[], io = defaultIo()): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if (flag(parsed, "version")) { io.out(VERSION); return 0; }
    if (!parsed.command || flag(parsed, "help")) { io.out(parsed.command ? commandHelp(parsed.command) : helpText()); return 0; }
    loadDotEnv(process.cwd());
    switch (parsed.command) {
      case "init": return await commandInit(parsed, io);
      case "sites": return await commandSites(parsed, io);
      case "doctor": return await commandDoctor(parsed, io);
      case "report": return await commandReport(parsed, io);
      default: throw new AppError(`Unknown command: ${parsed.command}`, { code: "CLI_COMMAND_INVALID", hints: ["Run `gsc-ga --help`."] });
    }
  } catch (error) {
    const appError = toAppError(error, "Command failed.");
    io.err(formatError(appError));
    return 1;
  }
}

interface Io { out(value: string): void; err(value: string): void }
function defaultIo(): Io { return { out: (v) => process.stdout.write(`${v}\n`), err: (v) => process.stderr.write(`${v}\n`) }; }

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, FlagValue>();
  let command: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--") && !command) { command = token; continue; }
    if (!token.startsWith("--")) throw new AppError(`Unexpected argument: ${token}`, { code: "CLI_ARG_INVALID" });
    const equal = token.indexOf("=");
    if (equal > 2) { flags.set(token.slice(2, equal), token.slice(equal + 1)); continue; }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { flags.set(key, next); i += 1; } else flags.set(key, true);
  }
  return { command, flags };
}
function flag(args: ParsedArgs, key: string): boolean { return args.flags.get(key) === true; }
function value(args: ParsedArgs, key: string): string | undefined { const v = args.flags.get(key); return typeof v === "string" ? v : undefined; }
function configPath(args: ParsedArgs): string { return resolveConfigPath(value(args, "config")); }

async function commandInit(args: ParsedArgs, io: Io): Promise<number> {
  const output = path.resolve(value(args, "config") ?? path.join(value(args, "dir") ?? process.cwd(), "gsc-ga.config.json"));
  if (!flag(args, "force")) {
    try { await access(output); throw new AppError(`Refusing to overwrite: ${output}`, { code: "INIT_EXISTS", hints: ["Pass --force to replace it."] }); } catch (error) {
      if (error instanceof AppError) throw error;
    }
  }
  await mkdir(path.dirname(output), { recursive: true });
  const example = path.join(PACKAGE_ROOT, "config", "sites.example.json");
  try { await copyFile(example, output); } catch {
    await writeFile(output, `${JSON.stringify(starterConfig(), null, 2)}\n`, "utf8");
  }
  io.out(output);
  return 0;
}

async function commandSites(args: ParsedArgs, io: Io): Promise<number> {
  const sites = await loadSites(configPath(args));
  if (flag(args, "json")) io.out(JSON.stringify(sites, null, 2));
  else io.out(sites.map((site) => `${site.key}\t${site.label}\t${site.gscSiteUrl}\tGA4 ${site.ga4PropertyId}`).join("\n"));
  return 0;
}

async function commandDoctor(args: ParsedArgs, io: Io): Promise<number> {
  const checks: Array<{ name: string; status: "ok" | "error" | "warning"; detail: string }> = [];
  const file = configPath(args);
  let sites: SiteConfig[] = [];
  try { sites = await loadSites(file); checks.push({ name: "config", status: "ok", detail: `${file} (${sites.length} site(s))` }); }
  catch (error) { checks.push({ name: "config", status: "error", detail: toAppError(error, "Invalid config").message }); }
  const runtime = getRuntimeEnv();
  try { await validateCredentials(runtime); checks.push({ name: "credentials", status: "ok", detail: "Google credentials file is readable." }); }
  catch (error) { checks.push({ name: "credentials", status: "error", detail: toAppError(error, "Invalid credentials").message }); }
  for (const site of sites.filter((item) => item.clarity)) {
    const envName = site.clarity!.tokenEnv;
    checks.push({ name: `clarity:${site.key}`, status: process.env[envName] ? "ok" : "warning", detail: process.env[envName] ? `${envName} is set` : `${envName} is not set` });
  }
  const failed = checks.some((check) => check.status === "error");
  if (flag(args, "json")) io.out(JSON.stringify({ ok: !failed, checks }, null, 2));
  else io.out(checks.map((check) => `[${check.status.toUpperCase()}] ${check.name}: ${check.detail}`).join("\n"));
  return failed ? 1 : 0;
}

async function commandReport(args: ParsedArgs, io: Io): Promise<number> {
  const sites = await loadSites(configPath(args));
  const selected = selectedSites(args, sites);
  const days = Number(value(args, "days") ?? "7");
  const windows = buildComparisonWindows(days, value(args, "date-end"));
  const outputDir = path.resolve(value(args, "output") ?? process.env.GSC_GA_OUTPUT_DIR ?? "reports");
  const dryRun = flag(args, "dry-run");
  const runtime = getRuntimeEnv();
  if (!dryRun) await validateCredentials(runtime);
  const results: Array<{ site: string; output: string; windows: typeof windows }> = [];
  for (const site of selected) {
    const output = path.join(outputDir, `gsc-ga-report-${windows.reportDate}-${site.key}.md`);
    if (dryRun) { results.push({ site: site.key, output, windows }); continue; }
    const content = await generateReport(runtime, site, windows, flag(args, "with-clarity"));
    await writePrivateReport(outputDir, output, content);
    if (flag(args, "stdout")) io.out(content);
    results.push({ site: site.key, output, windows });
  }
  if (flag(args, "json")) io.out(JSON.stringify({ dryRun, reports: results }, null, 2));
  else if (dryRun || !flag(args, "stdout")) io.out(results.map((item) => `${item.site}\t${item.output}`).join("\n"));
  return 0;
}

export async function writePrivateReport(outputDir: string, output: string, content: string): Promise<void> {
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await writeFile(output, content, { encoding: "utf8", mode: 0o600 });
  await chmod(output, 0o600);
}

async function generateReport(env: AppEnv, site: SiteConfig, windows: ReturnType<typeof buildComparisonWindows>, clarity: boolean): Promise<string> {
  const [gscCurrent, gscPrevious, ga4Current, ga4Previous, clarityReport] = await Promise.all([
    fetchGscWindowReport(env, site, windows.current), fetchGscWindowReport(env, site, windows.previous),
    fetchGa4WindowReport(env, site, windows.current), fetchGa4WindowReport(env, site, windows.previous),
    clarity ? fetchClarityWindowReport(site) : Promise.resolve(null)
  ]);
  const report = { site, windows: { current: windows.current, previous: windows.previous }, gsc: { current: gscCurrent, previous: gscPrevious }, ga4: { current: ga4Current, previous: ga4Previous }, ...(clarityReport ? { clarity: clarityReport } : {}) };
  const insights = buildInsights(report, detectOpportunities(report));
  return renderReportMarkdown(report, insights, `SEO Report ${site.label} ${windows.reportDate}`, windows.reportDate).content;
}

function selectedSites(args: ParsedArgs, sites: SiteConfig[]): SiteConfig[] {
  const raw = [value(args, "site"), value(args, "sites")].filter(Boolean).join(",");
  const keys = [...new Set(raw.split(",").map((key) => key.trim()).filter(Boolean))];
  if (!keys.length) throw new AppError("Missing --site or --sites.", { code: "CLI_SITE_MISSING" });
  return keys.map((key) => getSiteByKey(sites, key));
}
function starterConfig(): unknown { return { sites: [{ key: "example-site", label: "Example Site", gscSiteUrl: "sc-domain:example.com", ga4PropertyId: "123456789" }] }; }

function helpText(): string { return `gsc-ga ${VERSION}\n\nUsage: gsc-ga <command> [options]\n\nCommands:\n  init      Create a starter config\n  sites     List configured sites\n  doctor    Validate config and credentials\n  report    Generate deterministic reports\n\nGlobal options:\n  --config <path>  Config file (fallback: GSC_GA_CONFIG, then ./gsc-ga.config.json)\n  --help           Show help\n  --version        Show version`; }
function commandHelp(command: string): string {
  const texts: Record<string, string> = {
    init: "Usage: gsc-ga init [--config <path> | --dir <path>] [--force]",
    sites: "Usage: gsc-ga sites [--config <path>] [--json]",
    doctor: "Usage: gsc-ga doctor [--config <path>] [--json]",
    report: "Usage: gsc-ga report (--site <key> | --sites <a,b>) [--days 7] [--date-end YYYY-MM-DD] [--output <dir>] [--stdout] [--json] [--with-clarity] [--dry-run]"
  };
  return texts[command] ?? helpText();
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const invokedFromPackageBin = process.argv[1] && path.basename(process.argv[1]) === "gsc-ga";
if (direct || invokedFromPackageBin) process.exitCode = await run(process.argv.slice(2));
