import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadSites } from "../src/config/sites.js";

async function writeConfig(tokenEnv: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gsc-ga-config-"));
  const file = path.join(dir, "config.json");
  await writeFile(file, JSON.stringify({
    sites: [{
      key: "demo",
      label: "Demo",
      gscSiteUrl: "sc-domain:example.com",
      ga4PropertyId: "123456789",
      clarity: { tokenEnv, numOfDays: 3 }
    }]
  }));
  return file;
}

describe("Clarity configuration", () => {
  it("accepts only the dedicated CLARITY_TOKEN_* environment namespace", async () => {
    const valid = await loadSites(await writeConfig("CLARITY_TOKEN_DEMO_1"));
    expect(valid[0].clarity?.tokenEnv).toBe("CLARITY_TOKEN_DEMO_1");

    await expect(loadSites(await writeConfig("NPM_TOKEN"))).rejects.toMatchObject({
      code: "CONFIG_INVALID"
    });
    await expect(loadSites(await writeConfig("AWS_SECRET_ACCESS_KEY"))).rejects.toMatchObject({
      code: "CONFIG_INVALID"
    });
  });
});
