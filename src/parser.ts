import { loadAsync } from 'jszip';

import {
  OnePuxData,
  OnePuxItem,
  OnePuxExport,
  OnePuxItemDetailsLoginField,
} from './types';

export const parse1PuxFile = async (
  fileContents: string | Buffer | Uint8Array,
) => {
  try {
    const zip = await loadAsync(fileContents);

    const attributesContent = await zip
      .file('export.attributes')
      .async('string');
    const attributes = JSON.parse(attributesContent);
    const dataContent = await zip.file('export.data').async('string');
    const data = JSON.parse(dataContent);

    return {
      attributes,
      data,
    } as OnePuxExport;
  } catch (error) {
    console.error('Failed to parse .1pux file');
    throw error;
  }
};

const escapeCSVValue = (value: string | number) => {
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  if (typeof value !== 'string') {
    return value.toString();
  }

  // Quote only when necessary: comma, double-quote or newline
  const needsQuoting =
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes(' ');
  if (!needsQuoting) return value;

  // Escape double quotes by doubling them. Preserve newlines inside quotes.
  return `"${value.replace(/"/g, '""')}"`;
};

type RowData = {
  name: string;
  tags: string;
  url: string;
  username: string;
  password: string;
  notes: string;
  extraFields: ExtraField[];
};

type ExtraFieldType =
  | 'username'
  | 'password'
  | 'url'
  | 'email'
  | 'date'
  | 'month'
  | 'credit'
  | 'phone'
  | 'totp'
  | 'text';

type ExtraField = { name: string; value: string; type: ExtraFieldType };

type ParseFieldTypeToExtraFieldType = (
  field: OnePuxItemDetailsLoginField,
) => ExtraFieldType;

const parseFieldTypeToExtraFieldType: ParseFieldTypeToExtraFieldType = (
  field,
) => {
  if (field.designation === 'username') {
    return 'username';
  } else if (field.designation === 'password') {
    return 'password';
  } else if (field.fieldType === 'E') {
    return 'email';
  } else if (field.fieldType === 'U') {
    return 'url';
  }
  return 'text';
};

export const parseToRowData = (
  item: OnePuxItem['item'],
  defaultTags?: string[],
) => {
  const rowData: RowData = {
    name: item.overview.title,
    tags: [...(defaultTags || []), ...(item.overview.tags || [])].join(','),
    url: item.overview.url || '',
    username: '',
    password: '',
    notes: item.details.notesPlain || '',
    extraFields: [],
  };

  // If this is a document-only item (no login fields) include it anyway,
  // but annotate `notes` with the document filename so it isn't lost.
  if (
    item.details.documentAttributes &&
    item.details.loginFields.length === 0
  ) {
    const docName = item.details.documentAttributes.fileName || '';
    rowData.notes = [rowData.notes, docName].filter(Boolean).join('\n');
    // continue processing (no early return)
  }

  // Extract username, password, and some extraFields
  item.details.loginFields.forEach((field) => {
    if (field.designation === 'username') {
      rowData.username = field.value;
    } else if (field.designation === 'password') {
      rowData.password = field.value;
    } else if (
      field.fieldType === 'I' ||
      field.fieldType === 'C' ||
      field.id.includes(';opid=__') ||
      field.value === ''
    ) {
      // Skip these noisy form-fields
      return;
    } else {
      rowData.extraFields.push({
        name: field.name || field.id,
        value: field.value,
        type: parseFieldTypeToExtraFieldType(field),
      });
    }
  });

  // Extract some more extraFields
  item.details.sections.forEach((section) => {
    section.fields.forEach((field) => {
      let value = '';
      let type: ExtraFieldType = 'text';

      if (Object.prototype.hasOwnProperty.call(field.value, 'concealed')) {
        value = field.value.concealed || '';
      } else if (
        Object.prototype.hasOwnProperty.call(field.value, 'reference')
      ) {
        value = field.value.reference || '';
      } else if (Object.prototype.hasOwnProperty.call(field.value, 'string')) {
        value = field.value.string || '';
      } else if (Object.prototype.hasOwnProperty.call(field.value, 'email')) {
        value = field.value.email || '';
        type = 'email';
      } else if (Object.prototype.hasOwnProperty.call(field.value, 'phone')) {
        value = field.value.phone || '';
        type = 'phone';
      } else if (Object.prototype.hasOwnProperty.call(field.value, 'url')) {
        value = field.value.url || '';
        type = 'url';
      } else if (Object.prototype.hasOwnProperty.call(field.value, 'totp')) {
        value = field.value.totp || '';
        type = 'totp';
      } else if (Object.prototype.hasOwnProperty.call(field.value, 'gender')) {
        value = field.value.gender || '';
      } else if (
        Object.prototype.hasOwnProperty.call(field.value, 'creditCardType')
      ) {
        value = field.value.creditCardType || '';
      } else if (
        Object.prototype.hasOwnProperty.call(field.value, 'creditCardNumber')
      ) {
        value = field.value.creditCardNumber || '';
        type = 'credit';
      } else if (
        Object.prototype.hasOwnProperty.call(field.value, 'monthYear')
      ) {
        value =
          (field.value.monthYear && field.value.monthYear.toString()) || '';
        type = 'month';
      } else if (Object.prototype.hasOwnProperty.call(field.value, 'date')) {
        value = (field.value.date && field.value.date.toString()) || '';
        type = 'date';
      } else {
        // Default, so no data is lost when something new comes up
        value = JSON.stringify(field.value);
      }

      rowData.extraFields.push({
        name: field.title || field.id,
        value,
        type,
      });
    });
  });

  return rowData;
};

export const CSV_HEADER = 'name,tags,url,username,password,notes,extraFields';

export const APPLE_CSV_HEADER = 'Title,URL,Username,Password,Notes,OTPAuth';

export const convertRowDataToAppleRow = (rowData: RowData) => {
  // Extract the first TOTP/OTPAuth field if present
  const otpField = rowData.extraFields.find((f) => f.type === 'totp');
  const otpAuth = otpField ? otpField.value : '';

  const username = rowData.username && rowData.username !== '' ? rowData.username : 'empty-username';
  const password = rowData.password && rowData.password !== '' ? rowData.password : 'empty-password';

  const row = [rowData.name, rowData.url, username, password, rowData.notes, otpAuth]
    .map(escapeCSVValue)
    .join(',');

  return row;
};

export const convertDataToRow = (rowData: RowData) => {
  const username = rowData.username && rowData.username !== '' ? rowData.username : 'empty-username';
  const password = rowData.password && rowData.password !== '' ? rowData.password : 'empty-password';

  const row = [
    rowData.name,
    rowData.tags,
    rowData.url,
    username,
    password,
    rowData.notes,
    JSON.stringify(rowData.extraFields),
  ]
    .map(escapeCSVValue)
    .join(',');

  return row;
};

const iterateItems = (
  onePuxData: OnePuxData,
  callback: (actualItem: any, vaultName: string) => void,
) => {
  onePuxData.accounts.forEach((account) => {
    account.vaults.forEach((vault) => {
      vault.items.forEach((entry) => {
        const rawEntry: any = entry as any;
        let actualItem = rawEntry.item || null;
        if (!actualItem && rawEntry.overview && rawEntry.details) {
          actualItem = rawEntry as any;
        }
        if (!actualItem) return;
        if (!actualItem.trashed) {
          callback(actualItem, vault.attrs.name);
        }
      });
    });
  });
};

export const convert1PuxDataToCSV = async (onePuxData: OnePuxData) => {
  const rows = [CSV_HEADER];

  iterateItems(onePuxData, (actualItem, vaultName) => {
    const rowData = parseToRowData(actualItem, [vaultName]);
    if (rowData) rows.push(convertDataToRow(rowData));
  });

  return rows.join('\n');
};

export const convert1PuxDataToAppleCSV = async (onePuxData: OnePuxData) => {
  const rows = [APPLE_CSV_HEADER];

  iterateItems(onePuxData, (actualItem, vaultName) => {
    const rowData = parseToRowData(actualItem, [vaultName]);
    if (rowData) rows.push(convertRowDataToAppleRow(rowData));
  });

  return rows.join('\n');
};
