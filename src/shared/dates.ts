import { AppError } from "./errors.js";

export interface DateWindow {
  startDate: string;
  endDate: string;
  label: string;
}

export interface ComparisonWindows {
  current: DateWindow;
  previous: DateWindow;
  reportDate: string;
}

export function buildComparisonWindows(days: number, dateEndInput?: string): ComparisonWindows {
  if (!Number.isInteger(days) || days <= 0) {
    throw new AppError(`days 必须是正整数，收到 ${String(days)}`, {
      code: "INVALID_DAYS",
      hints: ["将 --days 设置为正整数，例如 --days 7。"]
    });
  }

  const reportDate = dateEndInput ? parseDateOnly(dateEndInput) : startOfLocalDay(new Date());
  const currentEnd = reportDate;
  const currentStart = shiftDays(currentEnd, -(days - 1));
  const previousEnd = shiftDays(currentStart, -1);
  const previousStart = shiftDays(previousEnd, -(days - 1));

  return {
    current: {
      startDate: formatDate(currentStart),
      endDate: formatDate(currentEnd),
      label: `最近 ${days} 天`
    },
    previous: {
      startDate: formatDate(previousStart),
      endDate: formatDate(previousEnd),
      label: `前 ${days} 天`
    },
    reportDate: formatDate(currentEnd)
  };
}

export function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftDays(value: Date, delta: number): Date {
  const clone = new Date(value);
  clone.setDate(clone.getDate() + delta);
  return startOfLocalDay(clone);
}

export function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new AppError(`日期格式无效：${value}`, {
      code: "INVALID_DATE",
      hints: ["请使用 YYYY-MM-DD 格式，例如 2026-03-02。"]
    });
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new AppError(`日期不存在：${value}`, {
      code: "INVALID_DATE",
      hints: ["请确认月份和日期范围正确。"]
    });
  }

  return startOfLocalDay(date);
}
