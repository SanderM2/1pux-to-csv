#! /usr/bin/env ts-node

import { writeFileSync, readFileSync } from 'fs';
import { extname } from 'path';
import { Command } from 'commander';

import {
  parse1PuxFile,
  convert1PuxDataToCSV,
  parseToRowData,
  CSV_HEADER,
  convertDataToRow,
} from './parser';

const program = new Command();

const convert = async (
  inputFile: string,
  options: { outputFile?: string; verbose?: boolean; splitBy?: string },
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
  console.log(`splitBy option value: "${splitBy}"`);
  let csvString: string | null = null;
  if (splitBy === 'none') {
    csvString = await convert1PuxDataToCSV(parsedExport.data);
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
    console.log(`Writing CSV file: "${outputFile}"...`);
    writeFileSync(outputFile, csvString || '', { encoding: 'utf-8' });
    totalRowsWritten = csvString
      ? Math.max(0, csvString.split('\n').length - 1)
      : 0;
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

          if (splitBy === 'vault') {
            const key = vault.attrs.name || 'unknown';
            groups[key] = groups[key] || [];
            groups[key].push(convertDataToRow(rowData));
          } else if (splitBy === 'tag') {
            const itemTags: string[] = actualItem.overview?.tags || [];
            if (itemTags.length === 0) {
              groups['untagged'] = groups['untagged'] || [];
              groups['untagged'].push(convertDataToRow(rowData));
            } else {
              itemTags.forEach((t) => {
                const key = t || 'untagged';
                groups[key] = groups[key] || [];
                groups[key].push(convertDataToRow(rowData));
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
      const rows = groups[key];
      const outPath = `${inputBase}-${sanitize(key)}.csv`;
      const outCsv = `${CSV_HEADER}\n${rows.join('\n')}`;
      console.log(`Writing CSV file: "${outPath}" (${rows.length} rows)...`);
      writeFileSync(outPath, outCsv, { encoding: 'utf-8' });
      totalRowsWritten += rows.length;
    });
  }

  const rowsCount = totalRowsWritten;

  // If user asked for verbose, or the CSV is empty (only header), print debug info
  if (options.verbose || rowsCount === 0) {
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

      // collect up to 5 sample items with minimal info
      const samples: any[] = [];
      for (const account of accounts) {
        for (const vault of account.vaults || []) {
          for (const item of vault.items || []) {
            if (samples.length >= 5) break;
            samples.push({
              title: item.item?.overview?.title,
              trashed: item.item?.trashed,
              loginFields: (item.item?.details?.loginFields || []).length,
              sections: (item.item?.details?.sections || []).length,
              hasDocument: !!item.item?.details?.documentAttributes,
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
        ok: 0,
      };
      const examples: any = { trashed: [], document: [], noFields: [], ok: [] };

      for (const account of accounts) {
        for (const vault of account.vaults || []) {
          for (const item of vault.items || []) {
            if (!item.item) continue;
            if (item.item.trashed) {
              stats.skippedTrashed += 1;
              if (examples.trashed.length < 3)
                examples.trashed.push(item.item.overview?.title || null);
              continue;
            }

            const loginFields = item.item.details?.loginFields || [];
            const sections = item.item.details?.sections || [];
            const isDocument =
              !!item.item.details?.documentAttributes &&
              loginFields.length === 0;

            if (isDocument) {
              stats.skippedDocument += 1;
              if (examples.document.length < 3)
                examples.document.push(item.item.overview?.title || null);
            } else if (loginFields.length === 0 && sections.length === 0) {
              stats.skippedNoFields += 1;
              if (examples.noFields.length < 3)
                examples.noFields.push(item.item.overview?.title || null);
            } else {
              stats.ok += 1;
              if (examples.ok.length < 3)
                examples.ok.push(item.item.overview?.title || null);
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
      console.log(`    ok (would be exported): ${stats.ok}`);
      console.log('  example titles by class:');
      console.log(JSON.stringify(examples, null, 2));

      // Print a redacted structure for up to 3 sample items to help debugging
      const redacted: any[] = [];
      for (const account of accounts) {
        for (const vault of account.vaults || []) {
          for (const item of vault.items || []) {
            if (redacted.length >= 3) break;
            if (!item.item) continue;

            const lf = item.item.details?.loginFields || [];
            const secs = item.item.details?.sections || [];

            redacted.push({
              vault: vault.attrs?.name,
              overviewKeys: Object.keys(item.item.overview || {}),
              hasOverviewTitle: !!item.item.overview?.title,
              trashed: !!item.item.trashed,
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
              hasDocumentAttributes: !!item.item.details?.documentAttributes,
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
          rawSamples.push({
            vault: vault.attrs?.name,
            topLevelKeys: Object.keys(it),
            itemKeys: it.item ? Object.keys(it.item) : null,
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
    } catch (err) {
      console.error('Failed to print verbose debug info', err);
    }
  }
};

program
  .command('convert <inputFile>', { isDefault: true })
  .option('-o, --output-file <outputFile>', 'CSV output file path')
  .option('-v, --verbose', 'Print debug info')
  .option('--split-by <mode>', 'Split output by (none|vault|tag)', 'none')
  .description('Converts 1pux file to CSV')
  .action(convert);

program.parse(process.argv);
