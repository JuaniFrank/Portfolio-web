import type { BrokerImportCode, ImportFileKind, ImportPreviewSummary } from "../types";

export interface ParseContext {
  fileName: string;
  fileHash: string;
}

export interface BrokerAnalyzer {
  readonly code: BrokerImportCode;
  readonly name: string;
  readonly supportedFileKinds: ImportFileKind[];
  readonly acceptMimeTypes: string;
  parse(
    buffer: ArrayBuffer,
    context: ParseContext
  ): Promise<ImportPreviewSummary> | ImportPreviewSummary;
}
