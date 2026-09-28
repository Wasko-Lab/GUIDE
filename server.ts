import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import Database from 'better-sqlite3';
import fs from 'fs';
import readline from 'readline';
import rateLimit from 'express-rate-limit';

interface TsvRecord {
  Gene_Name: string;
  Experiment_Type: string;
  Mutant_Type: string;
  Phenotype: string;
  Chemical: string;
  Condition: string;
  Details: string;
  [key: string]: string;
}

let db: any = null;
try {
  const dbPath = path.join(process.cwd(), 'sgd_phenotypes.db');
  if (fs.existsSync(dbPath)) {
    db = new Database(dbPath, { readonly: true });
    console.log("Local SQLite database connected.");
  } else {
    console.log("Local SQLite database not found, skipping local DB initialization.");
  }
} catch (error) {
  console.error("Failed to initialize SQLite database. Local queries will be disabled.", error);
}

let tsvDb: TsvRecord[] | null = null;
try {
  const tsvPath = path.join(process.cwd(), 'data', 'SGDphenotypes.tsv');
  if (fs.existsSync(tsvPath)) {
    const fileContent = fs.readFileSync(tsvPath, 'utf-8');
    const lines = fileContent.split(/\r?\n/);
    if (lines.length > 1) {
      const headers = lines[0].split('\t').map(h => h.trim());
      tsvDb = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const vals = lines[i].split('\t');
        const record: any = {};
        for (let j = 0; j < headers.length; j++) {
          let val = vals[j] ? vals[j].trim() : '';
          val = val.replace(/^"+|"+$/g, '').trim(); // Remove wrapping quotes
          record[headers[j] || `col_${j}`] = val;
        }
        tsvDb.push(record as TsvRecord);
      }
      console.log(`Loaded ${tsvDb.length} records from SGDphenotypes.tsv`);
    }
  } else {
    console.log("Local TSV database not found.");
  }
} catch (error) {
  console.error("Failed to load TSV database.", error);
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1); // Trust the reverse proxy
  const PORT = 3000;

  // Increase payload limit for base64 structure images
  app.use(express.json({ limit: '50mb' }));

  // Restrict CORS policy to only trusted origins
  app.use(cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (e.g., server-to-server), 
      // or from explicitly trusted domains.
      if (!origin || 
          origin.endsWith('.run.app') || 
          origin.endsWith('wasko.org') ||
          origin === 'https://ai.studio' || 
          origin.startsWith('http://localhost:')) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    }
  }));

  // Setup rate limiter for API routes
  const apiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 15 minutes
    max: 50, // Limit each IP to 50 requests per `window` (here, per 60 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { error: 'Too many requests from this IP, please try again after 15 minutes' }
  });

  // Apply the rate limiting middleware to API calls
  app.use('/api/', apiLimiter);

  // Proxy /api/phenotypes
  app.get('/api/phenotypes', async (req, res) => {
    try {
      const { sgdId, symbol } = req.query as { sgdId: string; symbol?: string };
      if (!sgdId && !symbol) return res.status(400).json({ error: "Missing sgdId or symbol" });

      // 1. Try hitting the external AGR API
      let agrSuccess = false;
      if (sgdId && sgdId !== "UNKNOWN") {
          const cleanedSgdId = sgdId.startsWith('SGD:') ? sgdId : `SGD:${sgdId}`;
          const url = `https://www.alliancegenome.org/api/gene/${encodeURIComponent(cleanedSgdId)}/phenotypes`;
          console.log(`Querying AGR API first: ${url}`);
          
          try {
              const agrRes = await fetch(url);
              if (agrRes.ok) {
                  const data = await agrRes.json();
                  if (data.results && data.results.length > 0) {
                     console.log(`Found ${data.results.length} phenotypes from AGR`);
                     return res.json(data);
                  } else {
                     console.log(`AGR query returned empty results, falling back to local DB/TSV`);
                  }
              } else {
                  console.warn(`AGR return status ${agrRes.status}`);
              }
          } catch (e) {
              console.warn(`Failed to fetch from AGR`, e);
          }
      }

      console.log(`Falling back to local DB/TSV.`);
      // 1. Try Local SQLite Database
      let localRecords: any[] = [];
      if (db) {
        if (symbol) {
          localRecords = db.prepare('SELECT * FROM phenotypes WHERE Gene_Name = ? OR Feature_Name = ?').all(symbol, symbol) as any[];
        }
        if (localRecords.length === 0 && sgdId && sgdId !== "UNKNOWN") {
          const cleanedSgdId = sgdId.startsWith('SGD:') ? sgdId : `SGD:${sgdId}`;
          localRecords = db.prepare('SELECT * FROM phenotypes WHERE SGDID = ? OR SGDID = ?').all(cleanedSgdId, sgdId.replace('SGD:', '')) as any[];
        }
      }

      // 1.5. Try Local TSV Database
      if (localRecords.length === 0 && tsvDb && symbol) {
        const querySymbol = symbol.toUpperCase();
        localRecords = tsvDb.filter((r) => r.Gene_Name && r.Gene_Name.toUpperCase() === querySymbol);
      }

      if (localRecords.length > 0) {
        console.log(`Found ${localRecords.length} records in local DB/TSV for ${symbol || sgdId}`);
        // Map to exact format expected by frontend (AGR format emulation)
        const mappedResults = localRecords.map(row => {
          let chem = row.Chemical && row.Chemical !== '""""""' && row.Chemical.trim() ? row.Chemical : '';
          let detailCondition = row.Details && row.Details !== '""""""' && row.Details.trim() ? row.Details.trim() : '';
          let mutantType = row.Mutant_Type && row.Mutant_Type.trim() ? row.Mutant_Type.trim() : '';

          let phenotypeStatement = '';
          if (chem && detailCondition) {
             phenotypeStatement = `${chem} (Condition: ${detailCondition})`;
          } else if (chem) {
             phenotypeStatement = chem;
          } else if (detailCondition) {
             phenotypeStatement = `Phenotype affected by ${detailCondition}`;
          } else {
             phenotypeStatement = `Observed phenotype`;
          }

          if (mutantType) {
             // Capitalize first letter of mutant type
             const capitalizedMutantType = mutantType.charAt(0).toUpperCase() + mutantType.slice(1);
             phenotypeStatement = `${capitalizedMutantType}: ${phenotypeStatement}`;
          }

          return {
            phenotypeStatement,
            primaryAnnotations: [{
              type: row.Experiment_Type || 'Unknown',
              evidenceItem: {
                shortCitation: row.Reference || 'SGD',
                referenceID: row.Reference || 'SGD'
              },
              phenotypeAnnotationSubject: {
                alleleSymbol: {
                  // row.Phenotype holds the allele (e.g., act1-S14A) in this TSV mapping
                  displayText: row.Phenotype || row.Mutant_Type || row.Allele || 'Unknown'
                }
              },
              conditionRelations: [{
                conditions: [{
                  conditionSummary: [row.Condition, row.Details].filter(Boolean).join(" | ") || ''
                }]
              }]
            }]
          };
        });
        return res.json({ results: mappedResults });
      }

      return res.json({ results: [] });

    } catch (err: any) {
      console.error("Error fetching phenotypes:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Streaming endpoint for SGA_stat_orthologs.tsv to avoid memory bloat
  app.get('/api/interactions', async (req, res) => {
    let gene = req.query.gene as string;
    if (!gene) {
        return res.status(400).json({ error: 'Missing gene parameter' });
    }
    
    gene = gene.toUpperCase();

    const tsvPath = path.join(process.cwd(), 'data', 'SGA_stat_orthologs.tsv');
    const zipPath = path.join(process.cwd(), 'data', 'SGA_stat_orthologs.zip');
    let targetFile = tsvPath;

    if (!fs.existsSync(tsvPath) && fs.existsSync(zipPath)) {
        try {
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(path.join(process.cwd(), 'data'), true);
        } catch (e) {
            console.error("Failed to unzip SGA data:", e);
        }
    }

    if (!fs.existsSync(tsvPath)) {
        return res.status(404).json({ error: 'SGA_stat_orthologs.tsv not found' });
    }

    try {
        const fileStream = fs.createReadStream(tsvPath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        const results: any[] = [];
        let isFirst = true;
        let headers: string[] = [];

        for await (const line of rl) {
            if (isFirst) {
                headers = line.split('\t').map((h: string) => h.trim());
                isFirst = false;
                continue;
            }

            // Quick string match before split to save CPU
            if (line.toUpperCase().includes(gene)) {
                const vals = line.split('\t');
                
                // Double check it's actually matching Query or Array column (Col 0, 1, 2, 3)
                if (vals[0].toUpperCase().includes(gene) || vals[1].toUpperCase().includes(gene) || vals[2].toUpperCase().includes(gene) || vals[3].toUpperCase().includes(gene)) {
                    const record: any = {};
                    for (let j = 0; j < headers.length; j++) {
                        let val = vals[j] ? vals[j].trim() : '';
                        val = val.replace(/^"+|"+$/g, '').trim();
                        record[headers[j] || `col_${j}`] = val;
                    }
                    results.push(record);
                    
                    // Cap results to prevent massive payloads if gene name is too common
                    if (results.length > 500) break;
                }
            }
        }
        
        res.json({ results });
    } catch (e: any) {
        console.error("Error reading interactions:", e);
        res.status(500).json({ error: 'Failed to read interaction data', msg: e.message, stack: e.stack });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
