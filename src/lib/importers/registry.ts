import type { BrokerImportCode } from "./types";
import {
  type BrokerAnalyzer,
  balanzAnalyzer,
  cocosAnalyzer,
  iolAnalyzer,
} from "./analyzers";

export interface BrokerImporterOption {
  code: BrokerImportCode;
  label: string;
  description: string;
  enabled: boolean;
  fileKinds: ("XLSX" | "CSV")[];
  accept: string;
  analyzer: BrokerAnalyzer;
}

export const BROKER_ANALYZERS: Record<BrokerImportCode, BrokerAnalyzer> = {
  BALANZ: balanzAnalyzer,
  COCOS: cocosAnalyzer,
  IOL: iolAnalyzer,
};

export const BROKER_IMPORTERS: BrokerImporterOption[] = [
  {
    code: "BALANZ",
    label: balanzAnalyzer.name,
    description: "Exportación de movimientos (.xlsx)",
    enabled: true,
    fileKinds: balanzAnalyzer.supportedFileKinds,
    accept: balanzAnalyzer.acceptMimeTypes,
    analyzer: balanzAnalyzer,
  },
  {
    code: "COCOS",
    label: cocosAnalyzer.name,
    description: "Próximamente",
    enabled: false,
    fileKinds: cocosAnalyzer.supportedFileKinds,
    accept: cocosAnalyzer.acceptMimeTypes,
    analyzer: cocosAnalyzer,
  },
  {
    code: "IOL",
    label: iolAnalyzer.name,
    description: "Próximamente",
    enabled: false,
    fileKinds: iolAnalyzer.supportedFileKinds,
    accept: iolAnalyzer.acceptMimeTypes,
    analyzer: iolAnalyzer,
  },
];

export function getBrokerImporter(code: BrokerImportCode): BrokerImporterOption | undefined {
  return BROKER_IMPORTERS.find((b) => b.code === code);
}

export function getBrokerAnalyzer(code: BrokerImportCode): BrokerAnalyzer {
  const analyzer = BROKER_ANALYZERS[code];
  if (!analyzer) {
    throw new Error(`No analyzer registered for broker code: ${code}`);
  }
  return analyzer;
}
