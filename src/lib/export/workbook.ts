import type { Contact } from '../../types/contact'
import { groupContactsByCompany, NO_COMPANY_LABEL } from '../db'
import type { ContactCompanyGroup } from '../db'
import {
  DATE_FORMAT,
  EXCEL_COLUMNS,
  HEADER_ROW_HEIGHT,
  TEXT_ONLY_COLUMNS,
  fieldValue,
  toExcelRow,
} from './columns'
import type { ExcelCellValue } from './columns'
import {
  ALL_CONTACTS_SHEET_DEFAULT,
  COMPANY_SUMMARY_SHEET,
  OTHER_CONTACTS_SHEET,
  reserveFixedSheetNames,
  uniqueSheetName,
} from './sheetNames'

/**
 * Minimal shape of the ExcelJS API this module uses.
 *
 * Declaring it structurally (instead of importing ExcelJS here) keeps the
 * workbook logic loadable and testable without pulling in the library, and lets
 * the caller decide when ExcelJS is fetched.
 */
export interface WorkbookLike {
  creator: string
  created: Date
  worksheets: WorksheetLike[]
  addWorksheet(name: string, options?: Record<string, unknown>): WorksheetLike
  writeBuffer?: (options?: unknown) => Promise<ArrayBuffer>
  xlsx?: {
    writeBuffer?: (options?: unknown) => Promise<ArrayBuffer>
    write?: (options?: unknown) => Promise<ArrayBuffer>
  }
}

export interface WorksheetLike {
  name: string
  columns: unknown
  views: unknown[]
  autoFilter: unknown
  addRow(values: ExcelCellValue[]): RowLike
  /** Present on the real ExcelJS sheet; optional so the shape stays permissive. */
  getRow?(n: number): RowLike
  eachRow(callback: (row: RowLike, rowNumber: number) => void): void
  rowCount: number
  actualRowCount: number
}

export interface RowLike {
  height: number
  font?: { bold?: boolean }
  alignment?: { vertical?: string; wrapText?: boolean }
  fill?: { type: string; fgColor: { argb: string } }
  eachCell?: (
    options: { includeEmpty: boolean },
    callback: (cell: CellLike, colNumber: number) => void,
  ) => void
}

export interface CellLike {
  value: ExcelCellValue
  numFmt?: string
}

export interface ExcelJsModule {
  Workbook: new () => WorkbookLike
}

export const HEADER_FILL = 'FFEFF4E9'
export const SELECTED_CONTACTS_SHEET = 'Selected Contacts'

/* -------------------------------------------------------------------------- */
/*  Sheet plan                                                                 */
/* -------------------------------------------------------------------------- */

/** One planned worksheet for a company group. */
export interface PlannedSheet {
  /** `''` for the catch-all bucket. */
  groupKey: string
  sheetName: string
  contactCount: number
  isCatchAll: boolean
}

export interface SheetPlan {
  /** Sheet holding every exported contact. */
  detailSheet: string
  summarySheet: string
  companies: PlannedSheet[]
  /** Set only when at least one contact has no company. */
  othersSheet: string | null
  /** Companies whose original name could not be used verbatim. */
  renamed: { source: string; sheetName: string }[]
}

export interface PlanInput {
  contacts: Contact[]
  isSelection: boolean
}

/**
 * Works out every worksheet name up front.
 *
 * The UI renders the plan so what a user sees matches what they download, and
 * `buildWorkbook` consumes the same plan, so the two cannot disagree.
 */
export function planSheetNames({ contacts, isSelection }: PlanInput): SheetPlan {
  // Reserve the fixed names first so a company literally called
  // "Company Summary" cannot take that slot.
  const used = reserveFixedSheetNames()
  const detailSheet = uniqueSheetName(
    isSelection ? SELECTED_CONTACTS_SHEET : ALL_CONTACTS_SHEET_DEFAULT,
    used,
  )

  const renamed: { source: string; sheetName: string }[] = []
  const companies: PlannedSheet[] = []

  for (const group of groupContactsByCompany(contacts)) {
    const isCatchAll = group.catchAll
    const sheetName = isCatchAll ? OTHER_CONTACTS_SHEET : uniqueSheetName(group.key, used)

    // Record only the names that had to change, so the UI can flag them.
    if (!isCatchAll && group.key !== sheetName) {
      renamed.push({ source: group.key, sheetName })
    }

    companies.push({ groupKey: group.key, sheetName, contactCount: group.contacts.length, isCatchAll })
  }

  return {
    detailSheet,
    summarySheet: COMPANY_SUMMARY_SHEET,
    companies,
    othersSheet: companies.some((sheet) => sheet.isCatchAll) ? OTHER_CONTACTS_SHEET : null,
    renamed,
  }
}

/* -------------------------------------------------------------------------- */
/*  Workbook construction                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Builds the workbook for a set of contacts.
 *
 * Sheet layout:
 * 1. Every exported contact, one row each.
 * 2. Company Summary: one aggregate row per company.
 * 3. One sheet per company, holding that company's contacts.
 * 4. Other Contacts: the contacts that have no company.
 *
 * A contact appears at most once per sheet and only on sheets that make sense
 * for it: a contact with a company never appears in Other Contacts, and no
 * contact is repeated within a sheet.
 */
export function buildWorkbook(
  ExcelJS: ExcelJsModule,
  input: PlanInput & { createdAt: Date },
): WorkbookLike {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CardVault'
  workbook.created = input.createdAt

  const plan = planSheetNames(input)
  const groups = new Map<string, ContactCompanyGroup>(
    groupContactsByCompany(input.contacts).map((group) => [group.key, group]),
  )

  // Sheet 1: every exported contact.
  applyDetailSheet(
    workbook.addWorksheet(plan.detailSheet),
    input.contacts,
  )

  // Sheet 2: aggregate counts for the same export set.
  applySummarySheet(workbook.addWorksheet(plan.summarySheet), buildCompanySummary(input.contacts))

  // Sheets 3 and 4: per-company sheets and the no-company bucket.
  for (const planned of plan.companies) {
    const group = groups.get(planned.groupKey)

    applyDetailSheet(
      workbook.addWorksheet(planned.sheetName),
      group === undefined ? [] : group.contacts,
    )
  }

  return workbook
}

/**
 * Writes the header row, the data rows and all sheet-level formatting: bold
 * headers, a frozen header row, an autofilter over the header, and widths.
 */
export function applyDetailSheet(sheet: WorksheetLike, contacts: Contact[]): void {
  const lastColumn = columnLetter(EXCEL_COLUMNS.length)

  // `columns` sets widths and creates the header row automatically; the header
  // text is then written into row 1 so autofilter and freeze line up.
  sheet.columns = EXCEL_COLUMNS.map((column, index) => ({
    key: `c${index}`,
    header: column.heading,
    width: column.width,
    style: TEXT_ONLY_COLUMNS.has(index) ? { numFmt: '@' } : undefined,
  })) as unknown

  // Freeze the header so it stays visible while scrolling.
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: `${lastColumn}1` }

  const header = sheet.getRow ? sheet.getRow(1) : sheet.addRow([])
  header.height = HEADER_ROW_HEIGHT
  header.font = { bold: true }
  header.alignment = { vertical: 'middle' }
  header.fill = { type: 'pattern', fgColor: { argb: HEADER_FILL } }

  for (const contact of contacts) {
    sheet.addRow(toExcelRow(contact))
  }

  // Apply the date and text formats after the rows exist, so the rule lives in
  // one place and covers every written value.
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return

    row.eachCell?.({ includeEmpty: false }, (cell, colNumber) => {
      const column = EXCEL_COLUMNS[colNumber - 1]

      if (column === undefined) return

      if (column.kind === 'datetime') cell.numFmt = DATE_FORMAT

      if (TEXT_ONLY_COLUMNS.has(colNumber - 1)) cell.numFmt = '@'
    })
  })
}

const SUMMARY_COLUMNS = [
  { heading: 'Company', width: 36 },
  { heading: 'Contacts', width: 12 },
  { heading: 'With Email', width: 14 },
  { heading: 'With Phone', width: 14 },
]

export interface CompanySummaryRow {
  company: string
  contactCount: number
  emailCount: number
  phoneCount: number
}

/** Counts contacts, emails and phone numbers per company. */
export function buildCompanySummary(contacts: Contact[]): CompanySummaryRow[] {
  return groupContactsByCompany(contacts).map((group) => {
    let emailCount = 0
    let phoneCount = 0

    for (const contact of group.contacts) {
      if (fieldValue(contact, 'email') !== '') emailCount += 1

      // Either number counts, but a contact is counted at most once.
      if (
        fieldValue(contact, 'phone') !== '' ||
        fieldValue(contact, 'alternatePhone') !== ''
      ) {
        phoneCount += 1
      }
    }

    return {
      company: group.catchAll ? NO_COMPANY_LABEL : group.key,
      contactCount: group.contacts.length,
      emailCount,
      phoneCount,
    }
  })
}

function applySummarySheet(sheet: WorksheetLike, rows: CompanySummaryRow[]): void {
  sheet.columns = SUMMARY_COLUMNS.map((column, index) => ({
    key: `s${index}`,
    header: column.heading,
    width: column.width,
  })) as unknown

  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: `${columnLetter(SUMMARY_COLUMNS.length)}1` }

  const header = sheet.getRow ? sheet.getRow(1) : sheet.addRow([])
  header.height = HEADER_ROW_HEIGHT
  header.font = { bold: true }
  header.alignment = { vertical: 'middle' }
  header.fill = { type: 'pattern', fgColor: { argb: HEADER_FILL } }

  for (const row of rows) {
    sheet.addRow([row.company, row.contactCount, row.emailCount, row.phoneCount])
  }
}

/** 1 -> A, 27 -> AA. Used for the autofilter range. */
export function columnLetter(count: number): string {
  let value = count
  let letters = ''

  while (value > 0) {
    const remainder = (value - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    value = Math.floor((value - 1) / 26)
  }

  return letters === '' ? 'A' : letters
}