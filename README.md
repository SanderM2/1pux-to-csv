# 1pux to CSV

[![](https://github.com/BrunoBernardino/1pux-to-csv/workflows/Run%20Tests/badge.svg)](https://github.com/BrunoBernardino/1pux-to-csv/actions?workflow=Run+Tests)

## Changes in this fork

This fork ([SanderM2](https://github.com/SanderM2/1pux-to-csv)) was created because the original code no longer worked with 1Password 8 `.1pux` exports. All changes were tested against real 1Password 8 exported files.

### What changed

- **Compatibility fix**: 1Password 8 items are raw objects (not wrapped in `{ item: {...} }`). The parser now handles both formats.
- **`--format apple`**: export directly in Apple Passwords compatible CSV format (`Title`, `URL`, `Username`, `Password`, `Notes`, `OTPAuth`). TOTP/2FA codes are automatically mapped to the `OTPAuth` column.
- **`--split-by <mode>`**: creates one CSV per vault or one CSV per tag.
 - **`--max-per-csv <n>`**: split large CSV outputs into multiple files with at most `n` data rows per file (header preserved). Works with `--split-by` — each group is split independently and filenames receive an index suffix (for example: `file-1.csv`, `file-2.csv`, or `file-vaultname-1.csv`).
 - **Empty-field placeholders**: when an item has no username or password the CSV will include `empty-username` or `empty-password` respectively so importing tools see an explicit placeholder rather than an empty cell.
- **Newlines preserved**: CSV fields with newlines are correctly quoted (RFC-style) instead of stripped.
- **`--debug`**: prints detailed debug dumps (redacted samples, raw keys) when needed; short summaries of skipped items are always shown.
- **Documents preserved**: items that are documents are now included in the CSV — their filename is appended to the `Notes` column.

### Usage examples

Single CSV (default):

```bash
npx 1pux-to-csv file.1pux
```

Apple Passwords compatible CSV:

```bash
npx 1pux-to-csv file.1pux -- --format apple
npx 1pux-to-csv file.1pux -- --format apple -o apple_import.csv
```

Apple Passwords CSV split by vault:

```bash
npx 1pux-to-csv file.1pux -- --format apple --split-by vault
```

Apple Passwords CSV split by tag:

```bash
npx 1pux-to-csv file.1pux -- --format apple --split-by tag
```

Split by vault (standard format):

```bash
npx 1pux-to-csv file.1pux -- --split-by vault
```

Split large CSV into multiple files (100 rows per file):

```bash
npx 1pux-to-csv file.1pux -- --max-per-csv 100
```

Split by vault and limit each vault file to 100 rows:

```bash
npx 1pux-to-csv file.1pux -- --split-by vault --max-per-csv 100
```

Debug (detailed dumps):

```bash
npx 1pux-to-csv file.1pux -- --debug
```

### Apple Passwords import notes

- Apple Passwords expects exactly these columns: `Title`, `URL`, `Username`, `Password`, `Notes`, `OTPAuth`.
- `OTPAuth` is the `otpauth://totp/...` URL for 2FA codes. If an item has multiple TOTP fields only the first is used.
- Items with notes but no username/password (e.g. secure notes) are still exported.
- 1Password documents (items without login fields) are skipped — Apple Passwords has no equivalent.
- The CSV file contains all your passwords in plain text — delete it after a successful import.
---

This script converts a [1Password .1pux file](https://support.1password.com/1pux-format/) to a CSV file. It's been tested to be successfully imported into [Padloc](https://github.com/padloc/padloc) (`extraFields` currently ignored), but it should work for other alternatives as well.

**NOTE** Files attached to items are not exported (file contents are ignored). Document items are exported: their filename is appended to the `Notes` column.

CLI options quirk: Commander may not parse options placed after a `--` separator in some environments; if you pass options after `--` (for example when using `npm start --`), the tool reads them correctly. Examples below use `--` before flags when appropriate.

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

