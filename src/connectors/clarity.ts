import type { SiteConfig } from "../config/sites.js";
import type {
	ClarityDimensionRow,
	ClarityWindowReport,
} from "../domain/metrics.js";
import { AppError } from "../shared/errors.js";

const CLARITY_ENDPOINT =
	"https://www.clarity.ms/export-data/api/v1/project-live-insights";

type ClarityDimension = "URL" | "Device";

interface ClarityMetricBlock {
	metricName?: string;
	information?: Array<Record<string, unknown>>;
}

export async function fetchClarityWindowReport(
	site: SiteConfig,
): Promise<ClarityWindowReport | null> {
	if (!site.clarity) {
		return null;
	}

	const token =
		process.env[site.clarity.tokenEnv];
	if (!token) {
		const source = `environment variable ${site.clarity.tokenEnv}`;
		throw new AppError(`Clarity token 未配置：${source}`, {
			code: "CLARITY_TOKEN_MISSING",
			hints: [
				"Set the environment variable referenced by clarity.tokenEnv.",
			],
		});
	}

	const [byUrl, byDevice] = await Promise.all([
		fetchClarityDimension(token, site.clarity.numOfDays, "URL"),
		fetchClarityDimension(token, site.clarity.numOfDays, "Device"),
	]);

	return {
		numOfDays: site.clarity.numOfDays,
		byUrl,
		byDevice,
	};
}

async function fetchClarityDimension(
	token: string,
	numOfDays: 1 | 2 | 3,
	dimension: ClarityDimension,
): Promise<ClarityDimensionRow[]> {
	const query = new URLSearchParams({
		numOfDays: String(numOfDays),
		dimension1: dimension,
	});
	const requestUrl = `${CLARITY_ENDPOINT}?${query.toString()}`;

	const response = await fetch(requestUrl, {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
	});

	if (!response.ok) {
		const text = await response.text();
		throw buildClarityError(response.status, text, dimension);
	}

	const payload = (await response.json()) as unknown;
	return normalizeClarityResponse(payload, dimension);
}

export function normalizeClarityResponse(
	payload: unknown,
	dimension: ClarityDimension,
): ClarityDimensionRow[] {
	if (!Array.isArray(payload)) {
		return [];
	}

	const rowsByDimension = new Map<string, Record<string, number | string>>();

	for (const block of payload as ClarityMetricBlock[]) {
		const metricName = normalizeMetricName(block.metricName ?? "unknown");
		for (const item of block.information ?? []) {
			const dimensionValue = readDimensionValue(item, dimension);
			if (!dimensionValue) {
				continue;
			}

			const existing = rowsByDimension.get(dimensionValue) ?? {};
			for (const [key, value] of Object.entries(item)) {
				if (key === dimension) {
					continue;
				}

				existing[normalizeMetricKey(metricName, key)] =
					normalizeMetricValue(value);
			}
			rowsByDimension.set(dimensionValue, existing);
		}
	}

	return Array.from(rowsByDimension.entries())
		.map(([dimensionValue, metrics]) => ({
			dimension: dimensionValue,
			metrics,
		}))
		.sort(
			(left, right) =>
				getClarityMetric(right, ["traffic_totalSessionCount"]) -
				getClarityMetric(left, ["traffic_totalSessionCount"]),
		);
}

export function getClarityMetric(
	row: ClarityDimensionRow,
	keys: string[],
): number {
	for (const key of keys) {
		const value = row.metrics[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
	}

	return 0;
}

function readDimensionValue(
	item: Record<string, unknown>,
	dimension: ClarityDimension,
): string | null {
	const matchedKey = Object.keys(item).find(
		(key) => key.toLowerCase() === dimension.toLowerCase(),
	);
	const value = matchedKey ? item[matchedKey] : undefined;
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}

	return null;
}

function normalizeMetricName(metricName: string): string {
	return metricName
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toLowerCase();
}

function normalizeMetricKey(metricName: string, key: string): string {
	return `${metricName}_${key}`;
}

function normalizeMetricValue(value: unknown): number | string {
	if (typeof value === "number") {
		return value;
	}

	if (typeof value === "string") {
		const parsed = Number(value.replace(/,/g, ""));
		return Number.isFinite(parsed) && value.trim() !== "" ? parsed : value;
	}

	return String(value ?? "");
}

function buildClarityError(
	status: number,
	responseText: string,
	dimension: ClarityDimension,
): AppError {
	if (status === 401 || status === 403) {
		return new AppError(
			`Clarity Data Export API 授权失败（dimension=${dimension}）。`,
			{
				code: "CLARITY_FORBIDDEN",
				hints: [
					"确认 token 来自对应 Clarity project 的 Settings -> Data Export。",
					"确认 token 没有过期或被替换。",
				],
			},
		);
	}

	if (status === 429) {
		return new AppError(
			`Clarity Data Export API 今日请求次数已达上限（dimension=${dimension}）。`,
			{
				code: "CLARITY_RATE_LIMITED",
				hints: [
					"Clarity 每个 project 每天最多 10 次请求；等明天再跑，或减少批量站点数。",
				],
			},
		);
	}

	return new AppError(
		`Clarity Data Export API 请求失败（HTTP ${status}, dimension=${dimension}）。`,
		{
			code: "CLARITY_REQUEST_FAILED",
			hints: [responseText.slice(0, 500)],
		},
	);
}
