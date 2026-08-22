export const logger = {
  info(message: string): void {
    process.stdout.write(`${message}\n`);
  },
  warn(message: string): void {
    process.stderr.write(`WARN: ${message}\n`);
  },
  error(message: string): void {
    process.stderr.write(`ERROR: ${message}\n`);
  }
};
