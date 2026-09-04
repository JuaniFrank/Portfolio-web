import type { BrokerAnalyzer, ParseContext } from "./types";
import type { BrokerImportCode, ImportPreviewSummary } from "../types";

export class IolAnalyzer implements BrokerAnalyzer {
  readonly code: BrokerImportCode = "IOL";
  readonly name = "InvertirOnline";
  readonly supportedFileKinds = ["XLSX" as const, "CSV" as const];
  readonly acceptMimeTypes =
    ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

  async parse(
    _buffer: ArrayBuffer,
    _context: ParseContext
  ): Promise<ImportPreviewSummary> {
    throw new Error(
      "El importador de InvertirOnline (IOL) se encuentra en desarrollo y estará disponible próximamente."
    );
  }
}

export const iolAnalyzer = new IolAnalyzer();
