import { GeneInfo, OrthologInfo, Interaction, PartnerVariant } from '../types';
import { orthologs } from '../data/DIOPT_Best2026';
import summaryTsv from '../data/YeastHuman_Orthologs_Summary.tsv?raw';
import { checkConservation } from './align';

const parsedSummary = summaryTsv

  .split('\n')
  .slice(1)
  .filter(line => line.trim())
  .map(line => {
    const [humanSymbol, yeastSymbol, dioptScore, bestScore, bestScoreReverse] = line.split('\t');
    return {
      humanSymbol: humanSymbol?.trim()?.toUpperCase(),
      yeastSymbol: yeastSymbol?.trim()?.toUpperCase(),
      dioptScore: parseInt(dioptScore?.trim() || '0', 10),
      bestScore: (bestScore?.trim()?.toLowerCase() === 'yes'),
      bestScoreReverse: (bestScoreReverse?.trim()?.toLowerCase() === 'yes'),
    };
  });

export const getHumanGeneInfo = async (symbol: string): Promise<GeneInfo> => {
  const isEntrezId = /^\d+$/.test(symbol);
  let url = `https://mygene.info/v3/query?q=${symbol}&scopes=symbol,alias&fields=symbol,entrezgene,name,uniprot,type_of_gene&species=human`;
  if (isEntrezId) {
    url = `https://mygene.info/v3/gene/${symbol}?fields=symbol,entrezgene,name,uniprot,type_of_gene`;
  }
  const response = await fetch(url);
  const data = await response.json();
  let hit = isEntrezId ? data : (data.hits || [])[0];
  if (!hit) throw new Error("Gene not found in MyGene.info");
  
  let uniprotId = null;
  if (hit.uniprot) {
    if (typeof hit.uniprot === 'string') uniprotId = hit.uniprot;
    else if (hit.uniprot['Swiss-Prot']) uniprotId = Array.isArray(hit.uniprot['Swiss-Prot']) ? hit.uniprot['Swiss-Prot'][0] : hit.uniprot['Swiss-Prot'];
  }

  return {
    symbol: hit.symbol,
    name: hit.name,
    entrez_id: hit.entrezgene?.toString(),
    uniprot_id: uniprotId
  };
};

export const searchGenes = async (term: string, species: 'human' | 'yeast' = 'human'): Promise<{ symbol: string; name: string; entrez_id: string }[]> => {
  const speciesQuery = species === 'human' ? 'human' : '4932,559292';
  const url = `https://mygene.info/v3/query?q=${encodeURIComponent(term)}&species=${speciesQuery}&size=10&fields=symbol,name,entrezgene,uniprot`;
  const response = await fetch(url);
  const data = await response.json();
  if (!data.hits) return [];
  return data.hits.map((hit: any) => ({
    symbol: hit.symbol || hit.name || hit.query,
    name: hit.name || 'Unknown',
    entrez_id: hit.entrezgene?.toString()
  })).filter((g: any) => g.symbol && g.entrez_id);
};

export const getOrtholog = async (entrezId: string, sourceTax: string = '9606', targetTax: string = '4932', geneSymbol?: string): Promise<OrthologInfo | null> => {
  let matches: any[] = [];
  if (sourceTax === '9606') {
      matches = orthologs?.filter(r => r[2].toString() === entrezId) || [];
      if (matches.length === 0 && geneSymbol) {
          const upperSym = geneSymbol.toUpperCase();
          matches = orthologs?.filter(r => (r[3] as string).toUpperCase() === upperSym) || [];
      }
      if (matches.length > 0) {
          matches.sort((a, b) => (b[4] as number) - (a[4] as number));
          return { id: matches[0][0].toString(), symbol: matches[0][1] as string, score: matches[0][4] as number };
      }
  } else if (sourceTax === '4932') {
      matches = orthologs?.filter(r => r[0].toString() === entrezId) || [];
       if (matches.length === 0 && geneSymbol) {
          const upperSym = geneSymbol.toUpperCase();
          matches = orthologs?.filter(r => (r[1] as string).toUpperCase() === upperSym) || [];
      }
      if (matches.length > 0) {
          matches.sort((a, b) => (b[4] as number) - (a[4] as number));
          return { id: matches[0][2].toString(), symbol: matches[0][3] as string, score: matches[0][4] as number };
      }
  }
  return null;
};

export const getSgaInteractions = async (geneSymbol: string): Promise<{partner: string, score: number}[]> => {
    try {
        const response = await fetch(`/api/interactions?gene=${encodeURIComponent(geneSymbol)}`);
        if (!response.ok) return [];
        const data = await response.json();
        
        const results = [];
        for (const row of data.results || []) {
            let qGene = (row['Query allele name'] || '').split('-')[0].split('_')[0].trim().toUpperCase();
            let aGene = (row['Array allele name'] || '').split('-')[0].split('_')[0].trim().toUpperCase();
            
            if (qGene !== geneSymbol.toUpperCase() && aGene !== geneSymbol.toUpperCase()) {
                continue;
            }

            let partner = qGene === geneSymbol.toUpperCase() ? aGene : qGene;
            if (partner && partner !== geneSymbol.toUpperCase() && row['Genetic interaction score (ε)']) {
               results.push({ partner: partner, score: parseFloat(row['Genetic interaction score (ε)']) });
            }
        }
        return results;
    } catch (e) {
        console.warn("SGA fetch failed", e);
        return [];
    }
};

export const getStringInteractions = async (geneSymbol: string, speciesId = 9606): Promise<{partner: string, score: number}[]> => {
    const url = `https://string-db.org/api/json/network?identifiers=${geneSymbol}&species=${speciesId}`;
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        const data = await response.json();
        return data.map((d: any) => ({
            partner: d.preferredName_B,
            score: d.score
        }));
    } catch (e) {
        console.warn("STRING DB fetch failed", e);
        return [];
    }
};

export const getPdbeInterfaceResidues = async (uniprotId: string): Promise<Interaction[]> => {
    const url = `https://www.ebi.ac.uk/pdbe/graph-api/uniprot/interface_residues/${uniprotId}`;
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        const data = await response.json();
        if (data[uniprotId] && data[uniprotId].data) {
            const interfaces = data[uniprotId].data;
            const results: Interaction[] = [];
            for (const interaction of interfaces) {
                const partnerName = interaction.name || 'Unknown';
                const interactingAccession = interaction.accession || 'N/A';
                
                const targetResidues: number[] = [];
                for (const res of interaction.residues || []) {
                    if (res.startIndex != null) targetResidues.push(res.startIndex);
                }

                // Call reciprocal to get partner residues
                let partnerResidues: number[] = [];
                if (interactingAccession !== 'N/A') {
                    const pUrl = `https://www.ebi.ac.uk/pdbe/graph-api/uniprot/interface_residues/${interactingAccession}`;
                    const pResp = await fetch(pUrl);
                    if (pResp.ok) {
                        const pData = await pResp.json();
                        if (pData[interactingAccession] && pData[interactingAccession].data) {
                            for (const pInt of pData[interactingAccession].data) {
                                if (pInt.accession === uniprotId) {
                                    for (const pRes of pInt.residues || []) {
                                        if (pRes.startIndex != null) partnerResidues.push(pRes.startIndex);
                                    }
                                }
                            }
                        }
                    }
                }

                // IMPORTANT: We need the actual Gene Symbol for myvariant.info
                // So we will lookup the gene symbol from the interacting Accession here using mygene
                let resolvedSymbol = partnerName;
                if (interactingAccession !== 'N/A') {
                    try {
                        const mgUrl = `https://mygene.info/v3/query?q=${interactingAccession}&fields=symbol&species=human`;
                        const mgResp = await fetch(mgUrl);
                        if (mgResp.ok) {
                            const mgData = await mgResp.json();
                            if (mgData.hits && mgData.hits.length > 0 && mgData.hits[0].symbol) {
                                resolvedSymbol = mgData.hits[0].symbol;
                            }
                        }
                    } catch (e) {
                        // ignore
                    }
                }

                results.push({
                    targetSymbol: 'Query', // will be filled in caller
                    targetUniprot: uniprotId,
                    partnerSymbol: resolvedSymbol, 
                    partnerUniprot: interactingAccession,
                    targetResidues: [...new Set(targetResidues)],
                    partnerResidues: [...new Set(partnerResidues)],
                    score: 1.0,
                    sources: ['PDBe-KB']
                });
            }
            return results;
        }
    } catch (e) {
        console.warn("PDBe fetch failed", e);
    }
    return [];
};

const sequenceCache = new Map<string, string>();

async function getProteinSequence(gene: string, organismId: string): Promise<string | null> {
    const key = `${gene}_${organismId}`;
    if (sequenceCache.has(key)) return sequenceCache.get(key) || null;
    try {
        const res = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=(gene:${gene})%20AND%20(organism_id:${organismId})&fields=sequence`);
        const data = await res.json();
        const seq = data.results?.[0]?.sequence?.value;
        if (seq) {
            sequenceCache.set(key, seq);
            return seq;
        }
    } catch(e) {}
    sequenceCache.set(key, '');
    return null;
}

export const fetchPartnerVariants = async (partnerGeneSymbol: string, partnerResidues: number[], sources: string[]): Promise<PartnerVariant[]> => {
    // Sort by AlphaMissense score descending to prioritize pathogenic variants, maximizing utility of our size limit
    const url = `https://myvariant.info/v1/query?q=dbnsfp.genename:${partnerGeneSymbol}&sort=-dbnsfp.alphamissense.score&fields=dbnsfp.alphamissense,clinvar,gnomad_exome,gnomad_genome,hgvs,snpeff.ann&size=500`;
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        const data = await response.json();
        const hits = data.hits || [];
        if (hits.length === 0) return [];

        let humanSeq: string | null = null;
        let yeastSeq: string | null = null;
        let hasFetchedSeqs = false;

        const variants: PartnerVariant[] = [];

        for (const hit of hits) {
            let residue = -1;
            let proteinChange = '';
            
            // Try to parse from snpeff.ann first, it's the most reliable for amino acid changes
            if (hit.snpeff && hit.snpeff.ann) {
                const anns = Array.isArray(hit.snpeff.ann) ? hit.snpeff.ann : [hit.snpeff.ann];
                // Prefer missense_variant annotations
                const missenseAnn = anns.find((a: any) => a.effect === 'missense_variant' && a.hgvs_p);
                const targetAnn = missenseAnn || anns.find((a: any) => a.hgvs_p);
                
                if (targetAnn && targetAnn.hgvs_p) {
                    proteinChange = targetAnn.hgvs_p;
                    if (targetAnn.protein && targetAnn.protein.position) {
                        residue = parseInt(targetAnn.protein.position, 10);
                    } else {
                        const match = proteinChange.match(/p\.([a-zA-Z]+)(\d+)([a-zA-Z]+)/);
                        if (match) residue = parseInt(match[2], 10);
                    }
                }
            }

            let hgvsStr = '';
            if (hit.hgvs) {
                hgvsStr = Array.isArray(hit.hgvs) ? hit.hgvs.join(', ') : hit.hgvs;
            } else if (hit.clinvar?.hgvs?.protein) {
                const p = hit.clinvar.hgvs.protein;
                hgvsStr = Array.isArray(p) ? p.join(', ') : p;
            }

            // Fallback: parse from hgvs or clinvar.rcv.name
            if (residue === -1) {
                if (hgvsStr) {
                    const match = hgvsStr.match(/p\.([a-zA-Z]+)(\d+)([a-zA-Z]+)/);
                    if (match) {
                        residue = parseInt(match[2], 10);
                        proteinChange = match[0];
                    }
                }

                if (residue === -1 && hit.clinvar && hit.clinvar.variant_id) {
                   const name = Array.isArray(hit.clinvar.rcv) ? hit.clinvar.rcv[0]?.name : hit.clinvar?.rcv?.name;
                   if (name) {
                       const match = name.match(/p\.([a-zA-Z]+)(\d+)([a-zA-Z]+)/);
                       if (match) {
                           residue = parseInt(match[2], 10);
                           proteinChange = match[0];
                       }
                   }
                }
            }
            
            // If we still didn't find a residue, it's likely non-coding or we can't map it.
            if (residue === -1) continue;

            let orthoYeastSymbol = '';
            if (!hasFetchedSeqs) {
                hasFetchedSeqs = true;
                const orthoMatch = parsedSummary.find(s => s.humanSymbol === partnerGeneSymbol.toUpperCase());
                if (orthoMatch && orthoMatch.yeastSymbol) {
                    orthoYeastSymbol = orthoMatch.yeastSymbol;
                    humanSeq = await getProteinSequence(partnerGeneSymbol, '9606');
                    yeastSeq = await getProteinSequence(orthoMatch.yeastSymbol, '559292');
                    if (!yeastSeq) {
                        yeastSeq = await getProteinSequence(orthoMatch.yeastSymbol, '4932');
                    }
                }
            } else {
                const orthoMatch = parsedSummary.find(s => s.humanSymbol === partnerGeneSymbol.toUpperCase());
                if (orthoMatch && orthoMatch.yeastSymbol) {
                    orthoYeastSymbol = orthoMatch.yeastSymbol;
                }
            }

            let yeastChange = undefined;

            // The user requested to "narrow down to only those residues that are conserved in the yeast ortholog"
            if (humanSeq && yeastSeq) {
                const consResult = checkConservation(humanSeq, yeastSeq, residue);
                if (!consResult.isConserved) {
                    continue;
                }
                
                let mutantAa = '';
                const match = proteinChange.match(/p\.([a-zA-Z]+)(\d+)([a-zA-Z]+)/);
                if (match) {
                    mutantAa = match[3];
                    const aa3to1: {[key: string]: string} = {
                       "Ala": "A", "Arg": "R", "Asn": "N", "Asp": "D", "Cys": "C",
                       "Glu": "E", "Gln": "Q", "Gly": "G", "His": "H", "Ile": "I",
                       "Leu": "L", "Lys": "K", "Met": "M", "Phe": "F", "Pro": "P",
                       "Ser": "S", "Thr": "T", "Trp": "W", "Tyr": "Y", "Val": "V"
                    };
                    mutantAa = aa3to1[mutantAa] || mutantAa;
                }
                yeastChange = `${consResult.yeastAa}${consResult.yeastResidue}${mutantAa}`;
                
            } else {
                continue; 
            }

            const isInterfaceResidue = partnerResidues.includes(residue);

            let amScore = null;
            if (hit.dbnsfp && hit.dbnsfp.alphamissense && hit.dbnsfp.alphamissense.score) {
                amScore = parseFloat(hit.dbnsfp.alphamissense.score);
            }

            let gnomadFreq = null;
            if (hit.gnomad_genome && hit.gnomad_genome.af && hit.gnomad_genome.af.af) {
                gnomadFreq = hit.gnomad_genome.af.af;
            } else if (hit.gnomad_exome && hit.gnomad_exome.af && hit.gnomad_exome.af.af) {
                gnomadFreq = hit.gnomad_exome.af.af;
            }

            let sig = 'Uncertain significance';
            if (hit.clinvar && hit.clinvar.rcv) {
                const rcv = Array.isArray(hit.clinvar.rcv) ? hit.clinvar.rcv[0] : hit.clinvar.rcv;
                if (rcv && rcv.clinical_significance) sig = rcv.clinical_significance;
            }

            variants.push({
                geneSymbol: partnerGeneSymbol,
                hgvs: hgvsStr,
                proteinChange,
                residue,
                amScore,
                gnomadFreq,
                clinicalSignificance: sig,
                isInterfaceResidue,
                sources,
                yeastSymbol: orthoYeastSymbol,
                yeastChange: yeastChange
            });
        }
        return variants;
    } catch (e) {
        console.warn("fetchPartnerVariants failed", e);
        return [];
    }
};
