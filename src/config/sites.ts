import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { AppError } from "../shared/errors.js";

const ClaritySchema = z.object({
  tokenEnv: z.string().regex(
    /^CLARITY_TOKEN_[A-Z0-9_]+$/,
    "Use a dedicated CLARITY_TOKEN_* environment variable"
  ),
  numOfDays: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(3)
});

const FunnelEventSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1).optional(),
  aliases: z.array(z.string().min(1)).optional()
});

const SiteSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, numbers, and hyphens"),
  label: z.string().min(1),
  gscSiteUrl: z.string().min(1),
  ga4PropertyId: z.string().min(1),
  clarity: ClaritySchema.optional(),
  funnelEvents: z.array(FunnelEventSchema).optional()
});

const SitesConfigSchema = z.object({ sites: z.array(SiteSchema).min(1) });
export type SiteConfig = z.infer<typeof SiteSchema>;
export interface LoadedSitesConfig { path: string; sites: SiteConfig[] }

export function resolveConfigPath(explicitPath?: string, cwd = process.cwd(), env = process.env): string {
  const candidate = explicitPath || env.GSC_GA_CONFIG || "gsc-ga.config.json";
  return path.resolve(cwd, candidate);
}

export async function loadSites(configPath: string): Promise<SiteConfig[]> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    throw new AppError(`Unable to read config: ${configPath}`, {
      code: "CONFIG_NOT_FOUND",
      hints: ["Run `gsc-ga init` or pass --config /path/to/config.json."], cause: error
    });
  }

  let json: unknown;
  try { json = JSON.parse(raw); } catch (error) {
    throw new AppError(`Config is not valid JSON: ${configPath}`, { code: "CONFIG_INVALID_JSON", cause: error });
  }
  const parsed = SitesConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError("Config validation failed.", {
      code: "CONFIG_INVALID",
      hints: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    });
  }
  const keys = new Set<string>();
  for (const site of parsed.data.sites) {
    if (keys.has(site.key)) throw new AppError(`Duplicate site key: ${site.key}`, { code: "CONFIG_DUPLICATE_SITE" });
    keys.add(site.key);
    validateGscSiteUrl(site.gscSiteUrl);
    validateGa4PropertyId(site.ga4PropertyId);
  }
  return parsed.data.sites;
}

export function getSiteByKey(sites: SiteConfig[], key: string): SiteConfig {
  const site = sites.find((entry) => entry.key === key);
  if (!site) throw new AppError(`Unknown site key: ${key}`, { code: "SITE_NOT_FOUND", hints: ["Run `gsc-ga sites` to list configured keys."] });
  return site;
}

export function validateGa4PropertyId(value: string): void {
  if (!/^\d+$/.test(value)) {
    throw new AppError(`Invalid GA4 Property ID: ${value}`, {
      code: "GA4_PROPERTY_ID_INVALID",
      hints: ["Use the numeric Property ID from GA4 Admin, not a Data Stream ID."]
    });
  }
}

export function validateGscSiteUrl(value: string): void {
  if (value.startsWith("sc-domain:")) {
    if (!value.slice(10)) {
      throw new AppError(`Invalid GSC property: ${value}`, { code: "GSC_SITE_URL_INVALID" });
    }
    return;
  }
  let parsed: URL;
  try { parsed = new URL(value); } catch {
    throw new AppError(`Invalid GSC property: ${value}`, { code: "GSC_SITE_URL_INVALID" });
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !value.endsWith("/")) {
    throw new AppError(`Invalid GSC URL-prefix property: ${value}`, { code: "GSC_SITE_URL_INVALID", hints: ["Use http(s) and include the trailing slash."] });
  }
}
