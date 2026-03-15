# 1pux to CSV

[![](https://github.com/BrunoBernardino/1pux-to-csv/workflows/Run%20Tests/badge.svg)](https://github.com/BrunoBernardino/1pux-to-csv/actions?workflow=Run+Tests)

## Changes in this fork

This fork (SanderM2) contains local improvements made while debugging a real `.1pux` export. Key changes:

- Added a `--verbose` debug mode that prints parser statistics and redacted sample structures to help diagnose why items may be skipped.
- Preserve newlines inside CSV fields (RFC-style quoting) and escape double quotes properly.
- Added `--split-by <mode>` CLI option to export multiple CSV files:
	- `--split-by vault` — creates one CSV per vault (filename: `<inputBase>-<vault>.csv`).
	- `--split-by tag` — creates one CSV per tag (items without tags go to `untagged`).
- Support for `vault.items` entries that are either wrapped (`{ item: { ... } }`) or raw item objects and skip file-only entries.
- Improved logging and classification to explain skipped items (trashed, documents, no fields).

All tests pass when run against 1Password 8 exported `.1pux` files. Use the examples below to try the new features.

### Examples

One CSV (default):

```bash
npx 1pux-to-csv file.1pux
```

Split by vault:

```bash
npx 1pux-to-csv file.1pux -- --split-by vault
```

Split by tag:

```bash
npx 1pux-to-csv file.1pux -- --split-by tag
```

To enable verbose debugging output add `-- --verbose` after `npm start` or pass `--verbose` directly when running the built `dist` binary.

---

This script converts a [1Password .1pux file](https://support.1password.com/1pux-format/) to a CSV file. It's been tested to be successfully imported into [Padloc](https://github.com/padloc/padloc) (`extraFields` currently ignored), but it should work for other alternatives as well.

**NOTE** Files and documents aren't supported (they'll be ignored). Feel free to open a PR for it once 1Password adds support for them.

## Usage (CLI)

Assuming you already have `npx` installed via `npm`:

```bash
npx 1pux-to-csv file.1pux
npx 1pux-to-csv file.1pux -o file.csv
```

Either of these will create a `file.csv` file with all the exported data. The first tag for every item will be the vault's name. Note that two-factor code generators (one-time passwords) are also included in this data export.

## Usage (Library)

```bash
npm install --save-exact 1pux-to-csv
```

```typescript
// If you need the types
import { OnePuxExport, OnePuxData, OnePuxItem } from '1pux-to-csv/types';

// If you need a parser function
import { parse1PuxFile, parseToRowData } from '1pux-to-csv';
```

## Development

```bash
npm install
npm run prettier
npm test
npm run build
npm run build/test
npm start file.1pux
```

## Deployment

```bash
npm version <patch|minor|major>
npm run deploy
```

## Changes in this fork

This fork contains local improvements made while debugging a real `.1pux` export. Key changes:

- Added a `--verbose` debug mode that prints parser statistics and redacted sample structures to help diagnose why items may be skipped.
- Preserve newlines inside CSV fields (RFC-style quoting) and escape double quotes properly.
- Added `--split-by <mode>` CLI option to export multiple CSV files:
	- `--split-by vault` — creates one CSV per vault (filename: `<inputBase>-<vault>.csv`).
	- `--split-by tag` — creates one CSV per tag (items without tags go to `untagged`).
- Support for `vault.items` entries that are either wrapped (`{ item: { ... } }`) or raw item objects and skip file-only entries.
- Improved logging and classification to explain skipped items (trashed, documents, no fields).

All tests pass when run against 1Password 8 exported `.1pux` files. Use the examples below to try the new features.

### Examples

One CSV (default):

```bash
npm start -- path/to/file.1pux
```

Split by vault:

```bash
npm start -- path/to/file.1pux -- --split-by vault
```

Split by tag:

```bash
npm start -- path/to/file.1pux -- --split-by tag
```

To enable verbose debugging output add `-- --verbose` after `npm start` or pass `--verbose` directly when running the built `dist` binary.

