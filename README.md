# gsc-ga-cli

A non-interactive command-line tool that turns Google Search Console and GA4 data into deterministic Markdown SEO reports. It is designed for humans, shell scripts, cron, CI, and external agents. Microsoft Clarity and GA4 activation-funnel reporting are optional.

## Requirements

- Node.js 20 or newer
- A Google service account with read access to the configured Search Console properties and GA4 properties
- Search Console API and Google Analytics Data API enabled

## Install

```bash
npm install --global gsc-ga-cli
gsc-ga --help
```

The package does not contain credentials or real site configuration. It resolves configuration from the caller's environment and current working directory, never from the package installation directory.

## Quick start

```bash
gsc-ga init
# Edit ./gsc-ga.config.json
gsc-ga sites
gsc-ga doctor
gsc-ga report --site example-site --days 7
```

`init` refuses to overwrite an existing file unless `--force` is supplied. Use `--dir` to choose a directory or `--config` to choose the exact file path.

## Configuration resolution

Commands resolve configuration in this order:

1. `--config /path/to/config.json`
2. `GSC_GA_CONFIG`
3. `./gsc-ga.config.json` in the caller's current directory

Copy `config/sites.example.json` or run `gsc-ga init`. A site supports:

```json
{
  "sites": [
    {
      "key": "example-site",
      "label": "Example Site",
      "gscSiteUrl": "sc-domain:example.com",
      "ga4PropertyId": "123456789",
      "funnelEvents": [
        { "name": "tool_start", "label": "Tool started" },
        { "name": "result_view", "aliases": ["legacy_result_view"] }
      ],
      "clarity": {
        "tokenEnv": "CLARITY_TOKEN_EXAMPLE",
        "numOfDays": 3
      }
    }
  ]
}
```

`gscSiteUrl` must exactly match an authorized Search Console property:

- Domain property: `sc-domain:example.com`
- URL-prefix property: `https://www.example.com/` (including trailing slash)

`ga4PropertyId` is the numeric Property ID, not a Data Stream ID.

Clarity tokens are environment-only by design. Set the variable named by `clarity.tokenEnv`; do not store tokens in configuration.

## Authentication

Set the standard Google credentials variable:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
```

A local `.env` in the caller's current directory is loaded when present. Process environment variables remain supported, making cron and CI invocation straightforward.

## Commands

### `init`

```bash
gsc-ga init [--dir ./project] [--force]
gsc-ga init --config ./config/seo.json
```

Writes a sanitized starter configuration and prints the absolute path to stdout.

### `sites`

```bash
gsc-ga sites
gsc-ga sites --config ./config.json --json
```

Text output is tab-separated. `--json` emits a JSON array suitable for automation.

### `doctor`

```bash
gsc-ga doctor
gsc-ga doctor --json
```

Validates configuration, credentials readability, and optional integration environment variables without making live API calls. Configuration or credential errors produce exit code 1. Missing optional Clarity tokens are warnings and do not fail the command.

### `report`

```bash
gsc-ga report --site example-site --days 7
gsc-ga report --sites site-a,site-b --date-end 2026-01-31 --output ./reports
gsc-ga report --site example-site --stdout
gsc-ga report --site example-site --with-clarity
gsc-ga report --site example-site --dry-run --json
```

Options:

- `--site <key>` or `--sites <a,b>` selects one or more sites.
- `--days <n>` defaults to 7 and compares the selected window with the immediately preceding window.
- `--date-end YYYY-MM-DD` makes runs reproducible.
- `--output <directory>` defaults to `GSC_GA_OUTPUT_DIR` or `./reports`.
- `--stdout` additionally writes Markdown to stdout.
- `--json` emits machine-readable run metadata. Do not combine it with `--stdout` for data-only stdout consumers.
- `--with-clarity` makes quota-limited Clarity requests for configured sites.
- `--dry-run` validates config, selection, dates, and output paths without credentials or network requests.

Reports are named `gsc-ga-report-YYYY-MM-DD-<site-key>.md`.

## Automation guarantees

- No prompts or terminal UI.
- Normal data goes to stdout; errors go to stderr.
- Success exits 0; validation/runtime failure exits nonzero.
- `--json` is stable machine-readable JSON where documented.
- `report --dry-run` incurs no API cost.
- Reports and credentials are not packaged.

## Development and publication checks

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm check:package
npm pack --dry-run
```

`prepublishOnly` runs tests, typechecking, build, and the package-content guard. Publishing is intentionally not performed by these scripts.

## License

MIT
