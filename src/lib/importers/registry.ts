import type { BrokerImportCode } from "./types";

export interface BrokerImporterOption {
  code: BrokerImportCode;
  label: string;
  description: string;
  enabled: boolean;
  fileKinds: ("XLSX" | "CSV")[];
  accept: string;
}

export const BROKER_IMPORTERS: BrokerImporterOption[] = [
  {
    code: "BALANZ",
    label: "Balanz",
    description: "Exportación de movimientos (.xlsx)",
    enabled: true,
    fileKinds: ["XLSX"],
    accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    code: "COCOS",
    label: "Cocos Capital",
    description: "Próximamente",
    enabled: false,
    fileKinds: ["XLSX"],
    accept: ".xlsx",
  },
  {
    code: "IOL",
    label: "InvertirOnline",
    description: "Próximamente",
    enabled: false,
    fileKinds: ["XLSX", "CSV"],
    accept: ".xlsx,.csv",
  },
];

export function getBrokerImporter(code: BrokerImportCode) {
  return BROKER_IMPORTERS.find((b) => b.code === code);
}
