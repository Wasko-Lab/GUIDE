# GUIDE 
### Gene Interaction Discovery Engine

**GUIDE** is a full-stack bioinformatics application designed to systematically identify interacting protein partners (physical, functional, and genetic) and prioritize pathogenic missense variants situated at protein-protein interaction interfaces. By integrating human clinical genetics with *Saccharomyces cerevisiae* (yeast) model organism orthology and structural biology, GUIDE enables researchers to pinpoint variants that disrupt molecular interfaces.

---

## Table of Contents
1. [Overview & Core Concept](#overview--core-concept)
2. [How the Software Functions](#how-the-software-functions)
   - [Step 1: Target Resolution & Orthology Mapping](#1-target-resolution--orthology-mapping)
   - [Step 2: Multi-Source Interaction Discovery](#2-multi-source-interaction-discovery)
   - [Step 3: Variant Ingestion, Alignment & Conservation Filtering](#3-variant-ingestion-alignment--conservation-filtering)
   - [Step 4: Prioritization Hierarchy](#4-prioritization-hierarchy)
   - [Step 5: Interactive Analysis & Data Export](#5-interactive-analysis--data-export)
3. [Data Sources & APIs](#data-sources--apis)
4. [Architecture & Technology Stack](#architecture--technology-stack)
5. [Local Development & Setup](#local-development--setup)
6. [Data Files & Storage](#data-files--storage)
7. [Disclaimers](#disclaimers)

---

## Overview & Core Concept

Missense variants in human disease frequently exert their pathogenic effects not by destabilizing the entire protein fold, but by perturbing specific binding surfaces with critical interacting partners (edgetic mutations). 

GUIDE automates the discovery of these interface mutations by:
1. Identifying physical, functional, and genetic interactors of a target gene.
2. Mapping between human genes and high-confidence *S. cerevisiae* orthologs.
3. Aligning protein sequences to confirm evolutionary conservation of the mutated residue.
4. Overlaying 3D structural interface contacts from experimental crystallographic/cryo-EM complexes.
5. Prioritizing variants using clinical assertions (ClinVar) and machine-learning pathogenicity predictions (AlphaMissense).

---

## How the Software Functions

### 1. Target Resolution & Orthology Mapping
* **Species Input:** The user enters a gene symbol and selects either **Homo sapiens (Human)** or **Saccharomyces cerevisiae (Yeast)**.
* **Metadata Resolution:** The backend/client queries [MyGene.info](https://mygene.info/) to validate gene symbols, retrieve official NCBI Entrez Gene IDs, and locate primary UniProtKB accessions.
* **DIOPT Orthology Translation:**
  * If a yeast gene is entered, GUIDE queries DRSC Integrative Ortholog Prediction Tool ([DIOPT](https://www.flyrnai.org/tools/diopt/web/)) high-confidence mappings to locate the primary human ortholog.
  * If a human gene is entered, GUIDE translates the symbol to the corresponding *S. cerevisiae* counterpart for downstream genetic interaction queries.

### 2. Multi-Source Interaction Discovery
GUIDE integrates three complementary lines of interaction evidence:
1. **PDBe-KB (Structural Interfaces):** Queries the European Bioinformatics Institute (PDBe-KB) graph API (`/uniprot/interface_residues/`) to retrieve experimentally determined structural interface contacts for the target protein and reciprocal contact residues on interacting partner chains.
2. **STRING DB (Protein Networks):** Queries the STRING database REST API for high-confidence physical and functional protein-protein association networks in *Homo sapiens*.
3. **Synthetic Genetic Array (SGA) Dataset:** Streams from genome-wide quantitative genetic interaction profiles (`data/SGA_stat_orthologs.tsv`). Significant negative and positive genetic interactions ($\epsilon$ scores) in yeast are cross-mapped back to human orthologs via DIOPT.

Interactors from all three pipelines are consolidated into a unified interaction network, tracking the provenance and evidence sources (`PDBe-KB`, `STRING`, `SGA`).

### 3. Variant Ingestion, Alignment & Conservation Filtering
For each interacting partner gene:
1. **Variant Retrieval:** Missense variants are fetched from [MyVariant.info](https://myvariant.info/), aggregating data from ClinVar, dbNSFP, AlphaMissense, and gnomAD.
2. **Protein Sequence Fetching:** Full-length amino acid sequences for human and yeast ortholog pairs are fetched from the [UniProt REST API](https://rest.uniprot.org/).
3. **Needleman-Wunsch Pairwise Alignment:** GUIDE executes dynamic programming global alignment (`needlemanWunsch`) between the human partner protein and its yeast ortholog.
4. **Conservation Filtering:** A human missense variant is retained **only if** the wild-type residue is conserved in the yeast ortholog (either an identical amino acid or conservative substitution according to standard physicochemical grouping).
5. **Yeast Allele Prediction:** For conserved positions, GUIDE computes the corresponding yeast amino acid mutation (e.g., human `p.Arg2381Ser` $\rightarrow$ yeast `R1965S`).

### 4. Prioritization Hierarchy
Variants in the resulting dataset are ranked using a multi-factor sorting strategy:
1. **Multi-Source Interactor Support:** Interactors supported by multiple independent lines of evidence (e.g., PDBe-KB structural complex + STRING + SGA) are ranked highest.
2. **Direct Interface Residue:** Variants falling directly on structural interface contact residues identified by PDBe-KB are flagged and prioritized over interior or non-interface surface residues.
3. **AlphaMissense Score:** Variants are ordered descending by AlphaMissense score ($>0.56$ considered likely pathogenic, $<0.34$ likely benign).

### 5. Interactive Analysis & Data Export
* **Live Pipeline Log:** An interactive terminal console tracks each stage of pipeline execution in real time (ortholog lookups, API queries, batch progress, and alignment statistics).
* **Summary Metrics:** Highlights the total number of unique partner genes, total prioritized variants, and total direct interface residues discovered.
* **Results Table:**
  * **Partner Gene:** Symbol and evidence badge chips (`PDBe-KB`, `STRING`, `SGA`).
  * **Yeast Ortho:** Corresponding *S. cerevisiae* gene.
  * **Residue & Changes:** Exact residue position, Human HGVS/protein change, and predicted Yeast protein change.
  * **Interface Rank:** Highlighting direct interaction interface residues.
  * **AlphaMissense Score:** Color-coded pathogenicity indicators.
  * **Clinical Significance:** ClinVar classification (Pathogenic, Benign, VUS, Conflicting).
* **CSV Export:** Complete CSV download with RFC 4180-compliant quote escaping for downstream spreadsheet analysis (`GUIDE_results_<GENE>.csv`).

---

## Data Sources & APIs

| Resource | Purpose | Provider / Endpoint |
| :--- | :--- | :--- |
| **MyGene.info** | Gene validation, Entrez IDs, UniProt mapping | `https://mygene.info/v3/` |
| **DIOPT** | Ortholog scoring & prediction between human and yeast | Local pre-computed DIOPT dataset |
| **PDBe-KB** | Structural contact residues at protein interfaces | `https://www.ebi.ac.uk/pdbe/graph-api/` |
| **STRING DB** | Human functional & physical protein interaction networks | `https://string-db.org/api/` |
| **SGA Network** | High-throughput yeast genetic interaction profiles | Local uncompressed dataset / `data/` |
| **UniProtKB** | Canonical protein sequences for pairwise alignment | `https://rest.uniprot.org/uniprotkb/` |
| **MyVariant.info** | AlphaMissense scores, ClinVar assertions, gnomAD allele frequencies | `https://myvariant.info/v1/` |

---

## Architecture & Technology Stack

* **Frontend:** React 19, TypeScript, Tailwind CSS, Lucide React icons.
* **Backend:** Node.js, Express 5, Vite middleware.
* **Sequence Alignment:** In-engine implementation of the Needleman-Wunsch algorithm for global sequence alignment and conservation classification.
* **File Handling:** Streaming readline parsers for large TSV datasets, `adm-zip` for on-demand extraction of compressed interaction files.
* **API Protection:** Express rate limiting (`express-rate-limit`) and scoped CORS policies.

---

## Local Development & Setup

### Prerequisites
* **Node.js:** v18.0.0 or higher
* **Package Manager:** npm or bun

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/guide.git
   cd guide
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   The application will start on `http://localhost:3000`.

4. **Build for production:**
   ```bash
   npm run build
   npm start
   ```

5. **Typecheck & Lint:**
   ```bash
   npm run lint
   ```

---

## Data Files & Storage

The `data/` directory contains pre-processed genomic and interaction datasets:
* `data/SGA_stat_orthologs.zip`: Compressed SGA genetic interaction network. Automatically extracted by the backend on first query into `data/SGA_stat_orthologs.tsv` (which is excluded from Git tracking via `.gitignore` to prevent repository bloat).
* `data/DIOPT_Best2026.ts` & `data/YeastHuman_Orthologs_Summary.tsv`: Curated DIOPT ortholog cross-references between Human and *S. cerevisiae*.
* `data/SGDphenotypes.tsv`: Saccharomyces Genome Database phenotype annotations.

---

## Disclaimers

**For Research Use Only (RUO).**  
GUIDE is a bioinformatics research tool. Variant predictions, conservation calculations, and interaction rankings are generated by algorithmic pipelines and public scientific databases. This software is not intended for direct clinical diagnosis or medical treatment decisions without independent functional and clinical validation.
