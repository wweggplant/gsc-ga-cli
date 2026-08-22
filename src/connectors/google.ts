import { GoogleAuth } from "google-auth-library";

import { AppError } from "../shared/errors.js";

export interface GoogleRequestOptions {
  scopes: string[];
  credentialsPath: string;
}

// Cache auth instances to avoid recreating them for each request
const authCache = new Map<string, GoogleAuth>();

async function getAuth(credentialsPath: string, scopes: string[]): Promise<GoogleAuth> {
  const cacheKey = `${credentialsPath}:${scopes.join(",")}`;
  let auth = authCache.get(cacheKey);

  if (!auth) {
    auth = new GoogleAuth({
      keyFile: credentialsPath,
      scopes
    });
    authCache.set(cacheKey, auth);
  }

  return auth;
}

export async function googleRequest<TResponse>(
  url: string,
  init: RequestInit,
  options: GoogleRequestOptions
): Promise<TResponse> {
  const auth = await getAuth(options.credentialsPath, options.scopes);

  const token = await auth.getAccessToken();
  if (!token) {
    throw new AppError("无法获取 Google API access token。", {
      code: "GOOGLE_AUTH_TOKEN_MISSING",
      hints: [
        "确认 Service Account JSON 文件有效。",
        "确认 GOOGLE_APPLICATION_CREDENTIALS 指向的是 JSON 文件。"
      ]
    });
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw buildGoogleApiError(response.status, text, url);
  }

  return (await response.json()) as TResponse;
}

export function wrapGoogleApiForbiddenError(
  error: unknown,
  contextMessage: string,
  errorCode: string,
  hints: string[]
): never {
  if (error instanceof AppError && error.code === "GOOGLE_API_FORBIDDEN") {
    throw new AppError(contextMessage, { code: errorCode, hints, cause: error });
  }
  throw error;
}

function buildGoogleApiError(status: number, responseText: string, url: string): AppError {
  const normalized = responseText.toLowerCase();

  if (normalized.includes("service_disabled") || normalized.includes("api has not been used")) {
    return new AppError("Google API 尚未启用。", {
      code: "GOOGLE_API_DISABLED",
      hints: [
        `确认目标 API 已在 Google Cloud Console 中启用：${url}`,
        "GSC 需要启用 Search Console API，GA4 需要启用 Analytics Data API。"
      ]
    });
  }

  if (status === 401 || status === 403) {
    return new AppError("Google API 权限不足或授权失败。", {
      code: "GOOGLE_API_FORBIDDEN",
      hints: [
        "确认 Service Account 已被加入对应的 GSC 站点和 GA4 Property。",
        "确认使用的是只读权限且资源名填写正确。"
      ]
    });
  }

  return new AppError(`Google API 请求失败（HTTP ${status}）。`, {
    code: "GOOGLE_API_REQUEST_FAILED",
    hints: [responseText.slice(0, 500)]
  });
}
