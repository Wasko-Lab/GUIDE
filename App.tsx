import React, { useState } from 'react';
import { Search, Loader2, Download, AlertCircle, RefreshCw, Dna } from 'lucide-react';
import { PipelineState, PartnerVariant, Interaction } from './types';
import { getHumanGeneInfo, searchGenes, getOrtholog, getStringInteractions, getPdbeInterfaceResidues, fetchPartnerVariants, getSgaInteractions } from './services/api';

export const App: React.FC = () => {
    const [geneInput, setGeneInput] = useState('');
    const [species, setSpecies] = useState<'human' | 'yeast'>('human');
    const [state, setState] = useState<PipelineState>({ step: 'idle', logs: [] });
    const [results, setResults] = useState<PartnerVariant[]>([]);
    const [interactions, setInteractions] = useState<Interaction[]>([]);

    const addLog = (msg: string) => {
        setState(s => ({ ...s, logs: [...s.logs, msg] }));
    };

    const runPipeline = async () => {
        if (!geneInput.trim()) return;
        setState({ step: 'searching', logs: ['Starting GUIDE pipeline...'], error: undefined, progress: 0 });
        setResults([]);
        setInteractions([]);

        try {
            let humanSymbol = '';
            let yeastSymbol = '';
            let uniprotId = '';

            if (species === 'yeast') {
                addLog(`Searching for Yeast gene: ${geneInput}...`);
                const yeastHits = await searchGenes(geneInput, 'yeast');
                if (yeastHits.length === 0) throw new Error(`Yeast gene '${geneInput}' not found.`);
                const yeastGene = yeastHits[0];
                yeastSymbol = yeastGene.symbol;
                addLog(`Found Yeast Gene: ${yeastSymbol}`);

                addLog(`Looking up Human Ortholog via DIOPT...`);
                const orth = await getOrtholog(yeastGene.entrez_id, '4932', '9606', yeastSymbol);
                if (!orth) throw new Error("No Human Ortholog found for this Yeast gene.");
                
                addLog(`Mapped to Human Gene: ${orth.symbol} (Score: ${orth.score})`);
                humanSymbol = orth.symbol;
            } else {
                addLog(`Searching Human gene: ${geneInput}...`);
                humanSymbol = geneInput;
                
                const humanHits = await searchGenes(geneInput, 'human');
                if (humanHits.length > 0) {
                    humanSymbol = humanHits[0].symbol;
                    addLog(`Looking up Yeast Ortholog via DIOPT...`);
                    const orth = await getOrtholog(humanHits[0].entrez_id, '9606', '4932', humanSymbol);
                    if (orth) {
                       yeastSymbol = orth.symbol;
                       addLog(`Mapped to Yeast Gene: ${yeastSymbol} (Score: ${orth.score})`);
                    } else {
                       addLog(`No Yeast Ortholog discovered for ${humanSymbol}.`);
                    }
                }
            }

            const humanInfo = await getHumanGeneInfo(humanSymbol);
            if (!humanInfo.uniprot_id) throw new Error(`No UniProt ID found for human gene ${humanInfo.symbol}`);
            humanSymbol = humanInfo.symbol;
            uniprotId = humanInfo.uniprot_id;
            
            addLog(`Target Identified: ${humanSymbol} (UniProt: ${uniprotId})`);
            setState(s => ({ ...s, progress: 10, targetHumanSymbol: humanSymbol, targetYeastSymbol: yeastSymbol }));

            // Find Interactions
            setState(s => ({ ...s, step: 'interactions', progress: 15 }));
            addLog(`Querying PDBe-KB for structural interface residues...`);
            let pdbeInteractions = await getPdbeInterfaceResidues(uniprotId);
            setState(s => ({ ...s, progress: 25 }));
            
            addLog(`Querying STRING DB for protein-protein interactions...`);
            let stringInteractions = await getStringInteractions(humanSymbol, 9606);
            setState(s => ({ ...s, progress: 35 }));

            let sgaInteractions: {partner: string, score: number, humanOrtholog?: string}[] = [];
            if (yeastSymbol) {
                 addLog(`Querying SGA for complex genetic dependencies (${yeastSymbol})...`);
                 const sgaData = await getSgaInteractions(yeastSymbol);
                 addLog(`SGA returned ${sgaData.length} interacting yeast alleles.`);
                 
                 // Need to map these back to Human Orthologs!
                 for (let k = 0; k < sgaData.length; k++) {
                      const sga = sgaData[k];
                      const orth = await getOrtholog('', '4932', '9606', sga.partner); // We only have symbol
                      if (orth && orth.symbol) {
                          sgaInteractions.push({ partner: sga.partner, score: sga.score, humanOrtholog: orth.symbol });
                      }
                      setState(s => ({ ...s, progress: 35 + Math.round((k / sgaData.length) * 5) }));
                 }
                 addLog(`Mapped ${sgaInteractions.length} SGA partners to human orthologs.`);
            }
            setState(s => ({ ...s, progress: 40 }));

            // Merge Partners
            const partnerGenes = new Map<string, Interaction>();
            
            // Map PDBe-KB Accessions to Gene Symbols via searchGenes
            addLog(`Resolving PDBe-KB partner symbols...`);
            for (const pdbe of pdbeInteractions || []) {
                if (pdbe.partnerUniprot && pdbe.partnerUniprot !== 'N/A') {
                    const sym = pdbe.partnerSymbol !== 'Unknown' ? pdbe.partnerSymbol.toUpperCase() : pdbe.partnerUniprot;
                    partnerGenes.set(sym, { ...pdbe, partnerSymbol: pdbe.partnerSymbol, sources: ['PDBe-KB'] });
                }
            }

            // Fill in STRING DB interactions
            for (const str of stringInteractions || []) {
                const sym = str.partner.toUpperCase();
                if (!partnerGenes.has(sym)) {
                    partnerGenes.set(sym, {
                        targetSymbol: humanSymbol,
                        targetUniprot: uniprotId,
                        partnerSymbol: str.partner,
                        partnerUniprot: '',
                        partnerResidues: [],
                        score: str.score,
                        sources: ['STRING']
                    });
                } else {
                    const existing = partnerGenes.get(sym)!;
                    if (!existing.sources.includes('STRING')) existing.sources.push('STRING');
                }
            }

            // Fill in SGA interactions
            let addedFromSga = 0;
            for (const sga of sgaInteractions) {
                if (sga.humanOrtholog) {
                     const sym = sga.humanOrtholog.toUpperCase();
                     if (!partnerGenes.has(sym)) {
                         partnerGenes.set(sym, {
                             targetSymbol: humanSymbol,
                             targetUniprot: uniprotId,
                             partnerSymbol: sga.humanOrtholog,
                             partnerUniprot: '',
                             partnerResidues: [],
                             score: 1.0,
                             sources: ['SGA']
                         });
                         addedFromSga++;
                     } else {
                         const existing = partnerGenes.get(sym)!;
                         if (!existing.sources.includes('SGA')) existing.sources.push('SGA');
                     }
                }
            }
            if (addedFromSga > 0) addLog(`Added ${addedFromSga} novel partners solely from Yeast SGA.`);

            const mergedInteractions = Array.from(partnerGenes.values());
            setInteractions(mergedInteractions);
            addLog(`Discovered ${mergedInteractions.length} interacting partners.`);

            if (mergedInteractions.length === 0) {
                addLog("No interactions found. Pipeline complete.");
                setState(s => ({ ...s, step: 'complete' }));
                return;
            }

            // Fetch Variants
            setState(s => ({ ...s, step: 'variants' }));
            addLog(`Fetching AlphaMissense and gnomAD variants for partners...`);
            
            let allVariants: PartnerVariant[] = [];
            
            // Fetch variants in batches of 5 to avoid overwhelming the API or browser
            const batchSize = 5;
            for (let i = 0; i < mergedInteractions.length; i += batchSize) {
                setState(s => ({ ...s, progress: 40 + Math.round((i / mergedInteractions.length) * 60) }));
                const batch = mergedInteractions.slice(i, i + batchSize);
                const batchPromises = batch.map(interactor => {
                    addLog(` Fetching variants for ${interactor.partnerSymbol}...`);
                    return fetchPartnerVariants(interactor.partnerSymbol, interactor.partnerResidues, interactor.sources);
                });
                const batchResults = await Promise.all(batchPromises);
                for (const vars of batchResults) {
                    allVariants = allVariants.concat(vars);
                }
            }
            setState(s => ({ ...s, progress: 100 }));

            addLog(`Found ${allVariants.length} missense variants across all partners.`);
            
            // Prioritize:
            // 1. Evidence count (multiple sources)
            // 2. Direct Interface Residues
            // 3. AlphaMissense score
            allVariants.sort((a, b) => {
                const aEvidence = a.sources.length;
                const bEvidence = b.sources.length;
                if (aEvidence !== bEvidence) return bEvidence - aEvidence;

                if (a.isInterfaceResidue && !b.isInterfaceResidue) return -1;
                if (!a.isInterfaceResidue && b.isInterfaceResidue) return 1;

                const amA = a.amScore || 0;
                const amB = b.amScore || 0;
                return amB - amA;
            });

            setResults(allVariants);
            const uniqueGenes = new Set(allVariants.map(v => v.geneSymbol)).size;
            const interfaceResidues = allVariants.filter(v => v.isInterfaceResidue).length;
            addLog(`Pipeline complete. Found ${uniqueGenes} genes with ${allVariants.length} pathogenic variants (${interfaceResidues} at interface residues).`);
            setState(s => ({ ...s, step: 'complete' }));

        } catch (e: any) {
            addLog(`Error: ${e.message}`);
            setState(s => ({ ...s, step: 'error', error: e.message }));
        }
    };

    const downloadCSV = () => {
        if (results.length === 0) return;
        const headers = ["Target Gene", "Target Yeast Ortholog", "Interacting Partner", "Yeast Interacting Ortholog", "Variant (HGVS)", "Protein Change (Human)", "Protein Change (Yeast)", "Residue Number", "Is Interface Residue?", "AlphaMissense Score", "gnomAD Frequency", "Clinical Significance"];
        const rows = results.map(r => [
            geneInput.toUpperCase(),
            state.targetYeastSymbol || '',
            r.geneSymbol,
            r.yeastSymbol || '',
            r.hgvs || '',
            r.proteinChange,
            r.yeastChange || '',
            r.residue,
            r.isInterfaceResidue ? "Yes" : "No",
            r.amScore !== null ? r.amScore.toFixed(4) : "N/A",
            r.gnomadFreq !== null ? r.gnomadFreq.toExponential(3) : "N/A",
            r.clinicalSignificance
        ]);
        
        const escapeCsv = (val: any) => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const csvContent = [
            headers.map(escapeCsv).join(","), 
            ...rows.map(r => r.map(escapeCsv).join(","))
        ].join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `GUIDE_results_${geneInput}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col font-sans">
            {/* Header */}
            <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-6 flex items-center justify-between shadow-sm">
                <div className="flex items-center space-x-3">
                    <div className="bg-indigo-600 p-2 rounded-lg text-white shadow-md">
                        <Dna size={28} className="animate-pulse" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">GUIDE</h1>
                        <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">Gene Interaction Discovery Engine</p>
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* Left Column: Controls & Logs */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                        <h2 className="text-lg font-semibold tracking-tight mb-4 flex items-center">
                            <Search size={18} className="mr-2 text-indigo-500" /> Interaction Query
                        </h2>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Species</label>
                                <select 
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                    value={species}
                                    onChange={(e) => setSpecies(e.target.value as 'human' | 'yeast')}
                                >
                                    <option value="human">Homo sapiens (Human)</option>
                                    <option value="yeast">S. cerevisiae (Yeast)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Gene Symbol</label>
                                <input 
                                    type="text" 
                                    placeholder="e.g. FKBP1A" 
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none uppercase placeholder:normal-case font-mono"
                                    value={geneInput}
                                    onChange={(e) => setGeneInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && runPipeline()}
                                />
                            </div>

                            <button 
                                onClick={runPipeline}
                                disabled={state.step !== 'idle' && state.step !== 'complete' && state.step !== 'error'}
                                className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-lg flex items-center justify-center space-x-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                            >
                                {(state.step !== 'idle' && state.step !== 'complete' && state.step !== 'error') ? (
                                    <><Loader2 size={18} className="animate-spin" /><span>Running Pipeline...</span></>
                                ) : (
                                    <><Search size={18} /><span>Discover Variants</span></>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Console Output */}
                    <div className="bg-[#1e1e1e] rounded-xl border border-slate-800 shadow-inner overflow-hidden flex flex-col h-[300px]">
                         <div className="bg-slate-800 px-4 py-2 border-b border-slate-700 flex justify-between items-center shrink-0">
                             <div className="flex space-x-2 items-center">
                                 <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                                 <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
                                 <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                             </div>
                             <span className="text-xs font-mono text-slate-400">pipeline.log</span>
                         </div>
                         <div className="p-4 overflow-y-auto flex-1 font-mono text-xs text-green-400 leading-relaxed break-words space-y-1">
                              {state.logs.map((log, i) => (
                                  <div key={i}>{'>'} {log}</div>
                              ))}
                              {state.step !== 'idle' && state.step !== 'complete' && state.step !== 'error' && (
                                  <div className="animate-pulse">{'>'} <span className="opacity-50">_</span></div>
                              )}
                         </div>
                    </div>
                </div>

                {/* Right Column: Data Table */}
                <div className="lg:col-span-2 flex flex-col min-h-[500px]">
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col flex-1 overflow-hidden">
                        
                        <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0 bg-slate-50 dark:bg-slate-800/50">
                            <div>
                                <h3 className="text-lg font-semibold tracking-tight flex items-center">
                                    Prioritized Interacting Variants
                                    {state.targetHumanSymbol && (
                                        <span className="ml-2 font-mono text-sm bg-slate-100 dark:bg-slate-700/50 px-2 py-0.5 rounded text-indigo-600 dark:text-indigo-400">
                                            {state.targetHumanSymbol} 
                                            {state.targetYeastSymbol && ` / ${state.targetYeastSymbol}`}
                                        </span>
                                    )}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 flex items-center space-x-3">
                                    <span><strong>Genes:</strong> {new Set(results.map(r => r.geneSymbol)).size}</span>
                                    <span className="opacity-40">|</span>
                                    <span><strong>Variants:</strong> {results.length}</span>
                                    <span className="opacity-40">|</span>
                                    <span><strong>Interface Residues:</strong> {results.filter(r => r.isInterfaceResidue).length}</span>
                                </p>
                            </div>
                            {results.length > 0 && (
                                <button 
                                    onClick={downloadCSV}
                                    className="text-sm bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 px-3 py-1.5 rounded-lg flex items-center space-x-2 transition shadow-sm font-medium"
                                >
                                    <Download size={16} /> <span>Export CSV</span>
                                </button>
                            )}
                        </div>

                        <div className="flex-1 overflow-auto bg-white dark:bg-[#151e32]">
                            {results.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-slate-50 dark:bg-transparent">
                                    {state.step === 'error' ? (
                                        <>
                                            <AlertCircle size={48} className="text-red-500 mb-4 opacity-80" />
                                            <h4 className="text-lg font-medium text-slate-800 dark:text-slate-200 mb-2">Pipeline Failed</h4>
                                            <p className="text-sm max-w-sm text-slate-500 dark:text-slate-400">{state.error}</p>
                                        </>
                                    ) : state.step === 'idle' ? (
                                        <>
                                            <Search size={48} className="text-slate-300 dark:text-slate-600 mb-4" />
                                            <p className="text-sm">Enter a target gene to discover interacting pathogenic variants.</p>
                                        </>
                                    ) : state.step === 'complete' ? (
                                        <>
                                            <RefreshCw size={48} className="text-slate-300 dark:text-slate-600 mb-4" />
                                            <p className="text-sm">No pathogenic variants or interacting proteins could be resolved for this gene.</p>
                                        </>
                                    ) : (
                                        <div className="w-full max-w-sm mx-auto">
                                            <div className="flex items-center justify-between mb-3 px-1">
                                                <div className="flex items-center space-x-2">
                                                    <Loader2 size={16} className="text-indigo-500 animate-spin" />
                                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                                        {state.step === 'variants' ? 'Fetching variants...' : 'Processing structural and sequential interactions...'}
                                                    </span>
                                                </div>
                                                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                                                    {state.progress ?? 0}%
                                                </span>
                                            </div>
                                            <div className="w-full h-3 bg-slate-200 dark:bg-slate-700/50 rounded-full overflow-hidden shadow-inner">
                                                <div 
                                                    className="h-full bg-indigo-500 rounded-full transition-all duration-300 ease-out bg-stripes animate-stripes shadow-[inset_0_1px_2px_rgba(255,255,255,0.2)]"
                                                    style={{ width: `${state.progress ?? 0}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <table className="w-full text-left border-collapse text-sm">
                                    <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 sticky top-0 shadow-sm backdrop-blur-sm z-10 font-medium">
                                        <tr>
                                            <th className="px-4 py-3 whitespace-nowrap">Partner Gene</th>
                                            <th className="px-4 py-3 whitespace-nowrap">Yeast Ortho</th>
                                            <th className="px-4 py-3 whitespace-nowrap">Residue</th>
                                            <th className="px-4 py-3 whitespace-nowrap">Change (Human)</th>
                                            <th className="px-4 py-3 whitespace-nowrap">Change (Yeast)</th>
                                            <th className="px-4 py-3 whitespace-nowrap text-center">Interface Rank</th>
                                            <th className="px-4 py-3 whitespace-nowrap text-right">AlphaMissense</th>
                                            <th className="px-4 py-3 whitespace-nowrap">Clinical Signif.</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800/50">
                                        {results.map((v, i) => (
                                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group">
                                                <td className="px-4 py-2.5 font-medium flex space-x-2 items-center">
                                                    <span>{v.geneSymbol}</span>
                                                    <div className="flex space-x-1">
                                                        {v.sources.map(src => (
                                                            <span key={src} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                                                                {src}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400 font-medium">
                                                    {v.yeastSymbol || <span className="opacity-40">-</span>}
                                                </td>
                                                <td className="px-4 py-2.5 font-mono text-xs text-slate-500 dark:text-slate-400">{v.residue}</td>
                                                <td className="px-4 py-2.5 font-mono text-xs text-slate-800 dark:text-slate-200 font-medium">{v.proteinChange}</td>
                                                <td className="px-4 py-2.5 font-mono text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                                                    {v.yeastChange || <span className="opacity-40">-</span>}
                                                </td>
                                                <td className="px-4 py-2.5 text-center">
                                                    {v.isInterfaceResidue ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30">
                                                            Direct Interaction
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400 dark:text-slate-600 text-xs">-</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-mono text-xs">
                                                    {v.amScore !== null ? (
                                                        <span className={v.amScore > 0.56 ? 'text-red-600 dark:text-red-400 font-bold' : (v.amScore < 0.34 ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400')}>
                                                            {v.amScore.toFixed(3)}
                                                        </span>
                                                    ) : <span className="opacity-50">N/A</span>}
                                                </td>
                                                <td className="px-4 py-2.5 whitespace-nowrap">
                                                    {v.clinicalSignificance !== "Unknown" ? (
                                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-medium ${
                                                            v.clinicalSignificance.includes('Pathogenic') ? 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300 border border-red-200 dark:border-red-500/30' :
                                                            v.clinicalSignificance.includes('Benign') ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30' :
                                                            'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30'
                                                        }`}>
                                                            {v.clinicalSignificance}
                                                        </span>
                                                    ) : <span className="text-slate-400 text-xs">-</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>

            </main>
        </div>
    );
};
