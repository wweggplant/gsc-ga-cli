import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (["node_modules", ".git", ".pi", "dist"].includes(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await files(full));
    else result.push(full);
  }
  return result;
}

describe("generic package boundary", () => {
  it("contains no forbidden knowledge-base integration terminology", async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const offenders: string[] = [];
    const forbidden = new RegExp(["obsi", "dian"].join(""), "i");
    for (const file of await files(root)) {
      if (file.endsWith("generic-boundary.test.ts")) continue;
      if (forbidden.test(await readFile(file, "utf8"))) offenders.push(path.relative(root, file));
    }
    expect(offenders).toEqual([]);
  });
});
