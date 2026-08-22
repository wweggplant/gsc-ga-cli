import { access } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import { AppError } from "../shared/errors.js";

export interface AppEnv {
  googleCredentialsPath: string;
}

export function loadDotEnv(cwd = process.cwd()): void {
  dotenv.config({ path: path.join(cwd, ".env"), quiet: true });
}

export function getRuntimeEnv(env = process.env): AppEnv {
  const credentials = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  return { googleCredentialsPath: credentials ? path.resolve(credentials) : "" };
}

export async function validateCredentials(env: AppEnv): Promise<void> {
  if (!env.googleCredentialsPath) {
    throw new AppError("Google credentials are not configured.", {
      code: "GOOGLE_CREDENTIALS_MISSING",
      hints: ["Set GOOGLE_APPLICATION_CREDENTIALS to a readable service-account JSON file or configure Google Application Default Credentials."]
    });
  }
  try { await access(env.googleCredentialsPath); } catch (error) {
    throw new AppError("Google credentials file is not readable.", {
      code: "GOOGLE_CREDENTIALS_UNREADABLE",
      hints: ["Check GOOGLE_APPLICATION_CREDENTIALS and the file permissions."],
      cause: error
    });
  }
}
