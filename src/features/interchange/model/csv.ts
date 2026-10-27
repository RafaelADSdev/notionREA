import { INTERCHANGE_LIMITS } from "./contracts";

export type CsvState = {
  field: string;
  row: string[];
  rowBytes: number;
  quoted: boolean;
  afterQuote: boolean;
  pendingCR: boolean;
  fresh: boolean;
};
export function initialCsvState(): CsvState {
  return { field: "", row: [], rowBytes: 0, quoted: false, afterQuote: false, pendingCR: false, fresh: true };
}
export function csvCell(input: string): { value: string; neutralized: boolean } {
  const neutralized = /^\s*[=+\-@]/u.test(input) || input.startsWith("'");
  return { value: `"${`${neutralized ? "'" : ""}${input}`.replaceAll('"', '""')}"`, neutralized };
}
export function restoreCsvCell(input: string, protectedExport: boolean): string {
  return protectedExport &&
    input.startsWith("'") &&
    (/^\s*[=+\-@]/u.test(input.slice(1)) || input.slice(1).startsWith("'"))
    ? input.slice(1)
    : input;
}
export function csvRow(values: readonly string[]): { text: string; neutralized: number } {
  const cells = values.map(csvCell);
  return {
    text: `${cells.map((cell) => cell.value).join(",")}\r\n`,
    neutralized: cells.filter((cell) => cell.neutralized).length,
  };
}
/** A serializable byte parser: no decoder state or entire CSV is retained between batches. */
export function parseCsvChunk(
  input: Uint8Array,
  previous: CsvState,
  maximumRows = 100,
  eof = false,
): { rows: string[][]; consumed: number; state: CsvState } {
  const state: CsvState = { ...previous, row: [...previous.row] };
  let field = [...Buffer.from(previous.field, "base64")];
  const rows: string[][] = [];
  const append = (byte: number) => {
    field.push(byte);
    state.fresh = false;
    if (field.length > INTERCHANGE_LIMITS.cellBytes || ++state.rowBytes > INTERCHANGE_LIMITS.rowBytes)
      throw new Error("CSV value exceeds its budget");
  };
  const endField = () => {
    state.row.push(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(field)));
    if (state.row.length > 500) throw new Error("Too many CSV columns");
    field = [];
    state.quoted = false;
    state.afterQuote = false;
  };
  const endRow = () => {
    endField();
    rows.push(state.row);
    state.row = [];
    state.rowBytes = 0;
    state.fresh = true;
  };
  let index = 0;
  for (; index < input.length; index++) {
    const byte = input[index];
    if (byte === undefined) break;
    if (state.pendingCR) {
      state.pendingCR = false;
      if (byte === 10) continue;
    }
    if (state.quoted && !state.afterQuote) {
      if (byte === 34) state.afterQuote = true;
      else append(byte);
      continue;
    }
    if (state.afterQuote && byte === 34) {
      append(34);
      state.afterQuote = false;
      continue;
    }
    if (state.afterQuote && ![44, 10, 13].includes(byte)) throw new Error("Invalid quoted CSV field");
    if (byte === 34) {
      if (field.length) throw new Error("Invalid CSV quote");
      state.quoted = true;
      state.fresh = false;
    } else if (byte === 44) {
      endField();
      state.fresh = false;
    } else if (byte === 10 || byte === 13) {
      endRow();
      state.pendingCR = byte === 13;
      if (rows.length >= maximumRows) {
        index++;
        break;
      }
    } else append(byte);
  }
  if (eof && index === input.length) {
    if (state.quoted && !state.afterQuote) throw new Error("Unterminated CSV field");
    if (!state.fresh || field.length || state.row.length) endRow();
  }
  state.field = Buffer.from(field).toString("base64");
  return { rows, consumed: index, state };
}
