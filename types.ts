
export interface GeneInfo {
  symbol: string;
  name: string;
  entrez_id: string;
  uniprot_id: string | null;
}

export interface OrthologInfo {
  id: string; // SGD ID or Symbol
  symbol: string;
  score: number;
}

export interface Interaction {
  targetSymbol: string;
  targetUniprot: string;
  partnerSymbol: string;
  partnerUniprot: string;
  partnerResidues: number[]; // e.g. [44, 45, 102]
  targetResidues?: number[];
  score: number; // interaction confidence
  sources: string[];
}

export interface PartnerVariant {
  geneSymbol: string;
  hgvs: string;
  proteinChange: string;
  residue: number;
  amScore: number | null; 
  gnomadFreq: number | null;
  clinicalSignificance: string;
  isInterfaceResidue: boolean;
  sources: string[];
  yeastSymbol?: string;
  yeastChange?: string;
}

export interface PipelineState {
  step: 'idle' | 'searching' | 'interactions' | 'variants' | 'complete' | 'error';
  error?: string;
  logs: string[];
  progress?: number;
  targetHumanSymbol?: string;
  targetYeastSymbol?: string;
}

