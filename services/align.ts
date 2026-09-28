export function needlemanWunsch(seq1: string, seq2: string): { align1: string, align2: string } {
    const match = 1;
    const mismatch = -1;
    const gap = -1;

    const m = seq1.length;
    const n = seq2.length;
    
    const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
    
    for (let i = 0; i <= m; i++) dp[i][0] = i * gap;
    for (let j = 0; j <= n; j++) dp[0][j] = j * gap;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const scoreDiagonal = dp[i - 1][j - 1] + (seq1[i - 1] === seq2[j - 1] ? match : mismatch);
            const scoreLeft = dp[i][j - 1] + gap;
            const scoreUp = dp[i - 1][j] + gap;
            dp[i][j] = Math.max(scoreDiagonal, scoreLeft, scoreUp);
        }
    }

    let align1 = "";
    let align2 = "";
    let i = m;
    let j = n;

    while (i > 0 && j > 0) {
        const scoreCurrent = dp[i][j];
        const scoreDiagonal = dp[i - 1][j - 1];
        const scoreLeft = dp[i][j - 1];
        const scoreUp = dp[i - 1][j];

        if (scoreCurrent === scoreDiagonal + (seq1[i - 1] === seq2[j - 1] ? match : mismatch)) {
            align1 = seq1[i - 1] + align1;
            align2 = seq2[j - 1] + align2;
            i--;
            j--;
        } else if (scoreCurrent === scoreLeft + gap) {
            align1 = "-" + align1;
            align2 = seq2[j - 1] + align2;
            j--;
        } else if (scoreCurrent === scoreUp + gap) {
            align1 = seq1[i - 1] + align1;
            align2 = "-" + align2;
            i--;
        }
    }

    while (i > 0) {
        align1 = seq1[i - 1] + align1;
        align2 = "-" + align2;
        i--;
    }

    while (j > 0) {
        align1 = "-" + align1;
        align2 = seq2[j - 1] + align2;
        j--;
    }

    return { align1, align2 };
}

export function checkConservation(humanSeq: string, yeastSeq: string, humanResidue1Based: number): { isConserved: boolean, yeastResidue?: number, humanAa?: string, yeastAa?: string } {
    if (!humanSeq || !yeastSeq || humanResidue1Based < 1 || humanResidue1Based > humanSeq.length) return { isConserved: false };
    
    // Quick Needleman-Wunsch is O(M*N), for 1000 aa it's 10^6 ops, very fast in JS.
    const { align1, align2 } = needlemanWunsch(humanSeq, yeastSeq);
    
    let humanIdx = 0;
    let yeastIdx = 0;
    for (let i = 0; i < align1.length; i++) {
        if (align2[i] !== '-') yeastIdx++;

        if (align1[i] !== '-') {
            humanIdx++;
            if (humanIdx === humanResidue1Based) {
                // We found the residue in human
                const humanAa = align1[i];
                const yeastAa = align2[i];
                if (yeastAa === '-') return { isConserved: false, humanAa, yeastAa }; // deletion
                
                // Exact match or conservative substitution could be considered "conserved".
                if (humanAa === yeastAa) return { isConserved: true, yeastResidue: yeastIdx, humanAa, yeastAa };
                
                const groups = [
                    ['A','I','L','V'],
                    ['F','W','Y'],
                    ['D','E'],
                    ['R','H','K'],
                    ['S','T','N','Q'],
                    ['C','M'],
                    ['G'],
                    ['P']
                ];
                
                for (const g of groups) {
                    if (g.includes(humanAa) && g.includes(yeastAa)) return { isConserved: true, yeastResidue: yeastIdx, humanAa, yeastAa };
                }
                
                return { isConserved: false, yeastResidue: yeastIdx, humanAa, yeastAa };
            }
        }
    }
    return { isConserved: false };
}
