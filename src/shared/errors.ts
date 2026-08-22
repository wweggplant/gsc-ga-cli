export interface AppErrorOptions {
  code?: string;
  hints?: string[];
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly hints: string[];

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = "AppError";
    this.code = options.code ?? "APP_ERROR";
    this.hints = options.hints ?? [];

    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(error.message || fallbackMessage, {
      code: "UNEXPECTED_ERROR",
      cause: error
    });
  }

  return new AppError(fallbackMessage, {
    code: "UNEXPECTED_ERROR",
    cause: error
  });
}

export function formatError(error: AppError): string {
  const lines = [`[${error.code}] ${error.message}`];

  if (error.hints.length > 0) {
    lines.push("排查建议:");
    for (const hint of error.hints) {
      lines.push(`- ${hint}`);
    }
  }

  return lines.join("\n");
}
