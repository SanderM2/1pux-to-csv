#! /usr/bin/env ts-node

import { writeFileSync, readFileSync } from 'fs';
import { extname } from 'path';
import { Command } from 'commander';

import {
  parse1PuxFile,
  convert1PuxDataToCSV,
  convert1PuxDataToAppleCSV,
  parseToRowData,
  CSV_HEADER,
  APPLE_CSV_HEADER,
  convertDataToRow,
  convertRowDataToAppleRow,
} from './parser';

const program = new Command();

const convert = async (
  inputFile: string,
  options: {
    outputFile?: string;
    verbose?: boolean;
    splitBy?: string;
    format?: string;
    maxPerCsv?: number | string;
  },
) => {
  const fileContents = readFileSync(inputFile, { encoding: null });
  const parsedExport = await parse1PuxFile(fileContents);
  // If splitBy is provided, we'll build multiple CSVs below; otherwise reuse existing converter
  const rawSplitBy = (options as any).splitBy;
  const argvFind = (name: string) => {
    const idx = process.argv.findIndex(
      (a) => a === name || a.startsWith(`${name}=`),
    );
    if (idx === -1) return null;
    const arg = process.argv[idx];
    if (arg.includes('=')) return arg.split('=')[1];
    return process.argv[idx + 1] || null;
  };

  const splitBy =
    rawSplitBy && rawSplitBy !== 'none'
      ? rawSplitBy
      : argvFind('--split-by') || 'none';

  const rawFormat = (options as any).format;
  const format =
    rawFormat && rawFormat !== 'standard'
      ? rawFormat
      : argvFind('--format') || 'standard';
  const isApple = format === 'apple';

  const rawMax = (options as any).maxPerCsv;
  const argvMax = argvFind('--max-per-csv');
  const maxPerCsv = (() => {
    const v = typeof rawMax !== 'undefined' && rawMax !== null ? rawMax : argvMax;
    const n = Number(v || 0);
    return Number.isFinite(n) && n > 0 ? Math.max(0, Math.floor(n)) : 0;
  })();

  let csvString: string | null = null;
  if (splitBy === 'none') {
    csvString = isApple
      ? await convert1PuxDataToAppleCSV(parsedExport.data)
      : await convert1PuxDataToCSV(parsedExport.data);
  }

  let { outputFile } = options;

  // Generate output file name, if none was given
  if (!outputFile) {
    const inputFileExtension = extname(inputFile);
    if (!inputFileExtension) {
      outputFile = `${inputFile}.csv`;
    } else {
      outputFile = inputFile.replace(
        new RegExp(`\\${inputFileExtension}$`, 'gi'),
        '.csv',
      );
    }
  }

  let totalRowsWritten = 0;

  if (splitBy === 'none') {
    // When a max-per-csv is provided, split the single CSV into multiple files
    const rows = csvString ? csvString.split('\n') : [];
    const header = rows.length > 0 ? rows[0] : '';
    const dataRows = rows.length > 1 ? rows.slice(1) : [];

    if (maxPerCsv > 0 && dataRows.length > maxPerCsv) {
      const base = outputFile ? outputFile.replace(/\.csv$/i, '') : inputFile.replace(/\.[^/.]+$/, '');
      const chunks: string[][] = [];
      for (let i = 0; i < dataRows.length; i += maxPerCsv) {
        chunks.push(dataRows.slice(i, i + maxPerCsv));
      }

      chunks.forEach((chunk, idx) => {
        const outPath = `${base}-${idx + 1}.csv`;
        const outCsv = header ? `${header}\n${chunk.join('\n')}` : chunk.join('\n');
        console.log(`Writing CSV file: "${outPath}" (${chunk.length} rows)...`);
        writeFileSync(outPath, outCsv, { encoding: 'utf-8' });
        totalRowsWritten += chunk.length;
      });
    } else {
      console.log(`Writing CSV file: "${outputFile}"...`);
      writeFileSync(outputFile, csvString || '', { encoding: 'utf-8' });
      totalRowsWritten = csvString
        ? Math.max(0, csvString.split('\n').length - 1)
        : 0;
    }
  } else {
    // Build grouped CSVs by 'vault' or 'tag'
    const groups: Record<string, string[]> = {};

    parsedExport.data.accounts.forEach((account) => {
      account.vaults.forEach((vault) => {
        vault.items.forEach((entry: any) => {
          let actualItem = entry.item || null;
          if (!actualItem && entry.overview && entry.details) {
            actualItem = entry;
          }
          if (!actualItem) return; // skip file entries
          if (actualItem.trashed) return;

          const rowData = parseToRowData(actualItem, [vault.attrs.name]);
          if (!rowData) return;

          const rowStr = isApple
            ? convertRowDataToAppleRow(rowData)
            : convertDataToRow(rowData);

          if (splitBy === 'vault') {
            const key = vault.attrs.name || 'unknown';
            groups[key] = groups[key] || [];
            groups[key].push(rowStr);
          } else if (splitBy === 'tag') {
            const itemTags: string[] = actualItem.overview?.tags || [];
            if (itemTags.length === 0) {
              groups['untagged'] = groups['untagged'] || [];
              groups['untagged'].push(rowStr);
            } else {
              itemTags.forEach((t) => {
                const key = t || 'untagged';
                groups[key] = groups[key] || [];
                groups[key].push(rowStr);
              });
            }
          }
        });
      });
    });

    // Write each group to a separate file
    const inputBase = outputFile
      ? outputFile.replace(/\.csv$/i, '')
      : inputFile.replace(/\.[^/.]+$/, '');

    const sanitize = (s: string) => s.replace(/[^a-z0-9.-]/gi, '_');

    const groupKeys = Object.keys(groups).sort();
    if (groupKeys.length === 0) {
      console.log(`No rows to write for split-by=${splitBy}`);
    }

    groupKeys.forEach((key) => {
      const rows = groups[key] || [];
      const activeHeader = isApple ? APPLE_CSV_HEADER : CSV_HEADER;

      if (maxPerCsv > 0 && rows.length > maxPerCsv) {
        // split this group's rows into multiple files
        const chunks: string[][] = [];
        for (let i = 0; i < rows.length; i += maxPerCsv) {
          chunks.push(rows.slice(i, i + maxPerCsv));
        }

        chunks.forEach((chunk, idx) => {
          const outPath = `${inputBase}-${sanitize(key)}-${idx + 1}.csv`;
          const outCsv = `${activeHeader}\n${chunk.join('\n')}`;
          console.log(`Writing CSV file: "${outPath}" (${chunk.length} rows)...`);
          writeFileSync(outPath, outCsv, { encoding: 'utf-8' });
          totalRowsWritten += chunk.length;
        });
      } else {
        const outPath = `${inputBase}-${sanitize(key)}.csv`;
        const outCsv = `${activeHeader}\n${rows.join('\n')}`;
        console.log(`Writing CSV file: "${outPath}" (${rows.length} rows)...`);
        writeFileSync(outPath, outCsv, { encoding: 'utf-8' });
        totalRowsWritten += rows.length;
      }
    });
  }

  const rowsCount = totalRowsWritten;

  try {
    const accounts = parsedExport.data.accounts || [];
    const vaultsCount = accounts.reduce(
      (acc, a) => acc + (a.vaults || []).length,
      0,
    );
    const itemsCount = accounts.reduce(
      (acc, a) =>
        acc +
        (a.vaults || []).reduce((va, v) => va + (v.items || []).length, 0),
      0,
    );

    // collect up to 5 sample items with minimal info (handle wrapped and raw items)
    const samples: any[] = [];
    for (const account of accounts) {
      for (const vault of account.vaults || []) {
        for (const item of vault.items || []) {
          if (samples.length >= 5) break;
          let actualItem: any = (item as any).item || null;
          if (!actualItem && (item as any).overview && (item as any).details)
            actualItem = item as any;
          if (!actualItem) continue;
          samples.push({
            title: actualItem.overview?.title,
            trashed: actualItem?.trashed,
            loginFields: (actualItem?.details?.loginFields || []).length,
            sections: (actualItem?.details?.sections || []).length,
            hasDocument: !!actualItem?.details?.documentAttributes,
            vault: vault.attrs?.name,
          });
        }
        if (samples.length >= 5) break;
      }
      if (samples.length >= 5) break;
    }

    console.log('Parser debug info:');
    console.log(`  accounts: ${accounts.length}`);
    console.log(`  vaults: ${vaultsCount}`);
    console.log(`  total items: ${itemsCount}`);
    console.log(`  csv rows (excluding header): ${rowsCount}`);
    // classify items to explain why rows might be missing
    const stats = {
      skippedTrashed: 0,
      skippedDocument: 0,
      skippedNoFields: 0,
      exported: 0,
    };
    const examples: any = {
      trashed: [],
      document: [],
      noFields: [],
      exported: [],
    };

    for (const account of accounts) {
      for (const vault of account.vaults || []) {
        for (const item of vault.items || []) {
          let actualItem: any = (item as any).item || null;
          if (!actualItem && (item as any).overview && (item as any).details)
            actualItem = item as any;
          if (!actualItem) continue;
          if (actualItem.trashed) {
            stats.skippedTrashed += 1;
            if (examples.trashed.length < 3)
              examples.trashed.push(actualItem.overview?.title || null);
            continue;
          }

          // Use parseToRowData to determine whether this item was exported
          const pd = parseToRowData(actualItem, [vault.attrs?.name]);
          if (pd) {
            stats.exported += 1;
            if (examples.exported.length < 3)
              examples.exported.push(actualItem.overview?.title || null);
          } else {
            const loginFields = actualItem.details?.loginFields || [];
            const sections = actualItem.details?.sections || [];
            const isDocument =
              !!actualItem.details?.documentAttributes &&
              loginFields.length === 0;

            if (isDocument) {
              stats.skippedDocument += 1;
              if (examples.document.length < 3)
                examples.document.push(actualItem.overview?.title || null);
            } else if (loginFields.length === 0 && sections.length === 0) {
              stats.skippedNoFields += 1;
              if (examples.noFields.length < 3)
                examples.noFields.push(actualItem.overview?.title || null);
            }
          }
        }
      }
    }

    console.log('  item classification:');
    console.log(`    trashed: ${stats.skippedTrashed}`);
    console.log(`    documents (skipped): ${stats.skippedDocument}`);
    console.log(
      `    no fields (login+sections empty): ${stats.skippedNoFields}`,
    );
    console.log(`    exported (written): ${stats.exported}`);

    const totalSkipped =
      stats.skippedTrashed + stats.skippedDocument + stats.skippedNoFields;

    // Always show which items were skipped (small examples) when anything was skipped.
    if (totalSkipped > 0) {
      console.log('  example titles by class:');
      console.log(JSON.stringify(examples, null, 2));
    } else if ((options as any).debug || rowsCount === 0) {
      console.log('  example titles by class:');
      console.log(JSON.stringify(examples, null, 2));
    }

    // Print detailed debug info only when `--debug` is provided or CSV is empty
    if ((options as any).debug || rowsCount === 0) {
      // Print a redacted structure for up to 3 sample items to help debugging
      const redacted: any[] = [];
      for (const account of accounts) {
        for (const vault of account.vaults || []) {
          for (const item of vault.items || []) {
            if (redacted.length >= 3) break;
            let actualItem: any = (item as any).item || null;
            if (!actualItem && (item as any).overview && (item as any).details)
              actualItem = item as any;
            if (!actualItem) continue;

            const lf = actualItem.details?.loginFields || [];
            const secs = actualItem.details?.sections || [];

            redacted.push({
              vault: vault.attrs?.name,
              overviewKeys: Object.keys(actualItem.overview || {}),
              hasOverviewTitle: !!actualItem.overview?.title,
              trashed: !!actualItem.trashed,
              loginFields: lf.map((f: any) => ({
                id: f.id,
                name: f.name || null,
                designation: f.designation || null,
                fieldType: f.fieldType,
              })),
              sections: secs.map((s: any) => ({
                title: s.title || null,
                fieldIds: s.fields.map((ff: any) => ff.id),
              })),
              hasDocumentAttributes: !!actualItem.details?.documentAttributes,
            });
          }
          if (redacted.length >= 3) break;
        }
        if (redacted.length >= 3) break;
      }

      console.log('  redacted sample item structures (no secret values):');
      console.log(JSON.stringify(redacted, null, 2));

      // Show top-level keys for a raw sample item in several vaults (no secret values)
      const rawSamples: any[] = [];
      for (const account of accounts) {
        for (const vault of account.vaults || []) {
          const [it] = vault.items || [];
          if (!it) continue;
          let actualItem: any = (it as any).item || null;
          if (!actualItem && (it as any).overview && (it as any).details)
            actualItem = it as any;
          rawSamples.push({
            vault: vault.attrs?.name,
            topLevelKeys: Object.keys(it),
            itemKeys: actualItem ? Object.keys(actualItem) : null,
            fileKeys: it.file ? Object.keys(it.file) : null,
          });
          if (rawSamples.length >= 5) break;
        }
        if (rawSamples.length >= 5) break;
      }

      console.log('  raw sample item keys (no values):');
      console.log(JSON.stringify(rawSamples, null, 2));
      console.log('  sample items:');
      console.log(JSON.stringify(samples, null, 2));
    }
  } catch (err) {
    console.error('Failed to print debug info', err);
  }
};

program
  .command('convert <inputFile>', { isDefault: true })
  .option('-o, --output-file <outputFile>', 'CSV output file path')
  .option('--debug', 'Print detailed debug dumps (includes redacted samples)')
  .option('--split-by <mode>', 'Split output by (none|vault|tag)', 'none')
  .option('--format <format>', 'Output format (standard|apple)', 'standard')
  .option('--max-per-csv <n>', 'Maximum data rows per CSV file (0 = no split)', '0')
  .description('Converts 1pux file to CSV')
  .action(convert);

program.parse(process.argv);
