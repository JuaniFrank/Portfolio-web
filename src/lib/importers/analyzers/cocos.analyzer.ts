import type { BrokerAnalyzer, ParseContext } from "./types";
import type { BrokerImportCode, ImportPreviewSummary } from "../types";

export class CocosAnalyzer implements BrokerAnalyzer {
  readonly code: BrokerImportCode = "COCOS";
  readonly name = "Cocos Capital";
  readonly supportedFileKinds = ["XLSX" as const];
  readonly acceptMimeTypes =
    ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  async parse(
    _buffer: ArrayBuffer,
    _context: ParseContext
  ): Promise<ImportPreviewSummary> {
    throw new Error(
      "El importador de Cocos Capital se encuentra en desarrollo y estará disponible próximamente."
    );
  }
}

export const cocosAnalyzer = new CocosAnalyzer();
