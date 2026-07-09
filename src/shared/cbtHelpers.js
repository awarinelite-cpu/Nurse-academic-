export const parseCbtQuestions = (qText, ansText = "") => {
  const ansLines = ansText.trim().split("\n").map(l => l.trim()).filter(Boolean);
  const normalized = qText.trim().split("\n").map(l => l.trimEnd()).join("\n");

  // Letter/roman → 0-3 index
  const LTR = {A:0,B:1,C:2,D:3,a:0,b:1,c:2,d:3,"1":0,"2":1,"3":2,"4":3,i:0,ii:1,iii:2,iv:3,I:0,II:1,III:2,IV:3};
  const mapLetter = (s) => { const k=s.trim(); return LTR[k]??LTR[k.toLowerCase()]??LTR[k.toUpperCase()]??0; };

  // Option line: A-D / 1-4 / roman, with ANY separator (. ) : - ] space)
  const OPT_RE = /^[\(\[]?\s*([A-Da-d]|[1-4]|i{1,3}v?)\s*[\)\]:.\)\-]\s*(.+)$/;
  // Option with SPACE-ONLY separator: "A some text" (only A-D, not 1-4, to avoid false positives)
  const OPT_SPACE_RE = /^([A-Da-d])\s{1,3}([^\s].{2,})$/;
  // Answer declaration line
  const ANS_RE = /^(?:ANS(?:WER)?|Ans(?:wer)?|Answer)\s*[-:.\)\s]\s*([A-Da-d1-4]|i{1,3}v?)\b/i;
  // Strip leading question number / Q: prefix
  const QSTRIP = /^(?:Q(?:uestion)?\s*\.?\s*\d*\s*[-:.)]?\s*|\d+\s*[.):\-]\s*)/i;
  // Detect a new question start: "1." "1)" "1:" "Q1" "Question 1"
  const Q_START_RE = /^(?:\d+\s*[.):\-]|Q(?:uestion)?\s*\.?\s*\d+)/i;

  const isOpt = (line) => {
    // Standard separator
    const m = line.match(OPT_RE);
    if (m) {
      if (/^[1-4]$/.test(m[1])) {
        const t = m[2].trim();
        if (t.split(/\s+/).length >= 5 || t.endsWith("?")) return false;
      }
      return true;
    }
    // Space-only separator (A text) — only A-D to avoid false positives
    const m2 = line.match(OPT_SPACE_RE);
    if (m2) {
      const t = m2[2].trim();
      // Must be short (not a question masquerading as an option)
      if (t.split(/\s+/).length <= 12 && !t.endsWith("?")) return true;
    }
    return false;
  };

  const getOptParts = (line) => {
    const m = line.match(OPT_RE);
    if (m) return [m[1], m[2]];
    const m2 = line.match(OPT_SPACE_RE);
    if (m2) return [m2[1], m2[2]];
    return null;
  };

  const isAns = (line) => ANS_RE.test(line);

  // Detect if a line starts a new question (numbered or Q-prefixed)
  const isQStart = (line) => {
    if (!line.trim()) return false;
    if (isOpt(line) || isAns(line)) return false;
    return Q_START_RE.test(line.trim());
  };

  // Expand compact single-line "Question A)opt B)opt C)opt D)opt" into separate lines
  const expandIfCompact = (line) => {
    const count = (line.match(/\b[A-Da-d]\s*[\):]\s*\S/g)||[]).length;
    if (count >= 3 && !isOpt(line) && !isAns(line)) {
      const parts = line.split(/\s+(?=[A-Da-d]\s*[\):.][^\s])/);
      if (parts.length >= 3) return parts;
    }
    return [line];
  };

  // Pre-process: expand compact lines
  const preLines = normalized.split("\n").flatMap(l => expandIfCompact(l.trimEnd()));
  const preText  = preLines.join("\n");
  const allLines = preText.split("\n");

  // ── Universal block splitter: ALWAYS split by question-start lines ─────────
  // This works whether there are blank lines or not, and handles mixed formats.
  const splitIntoBlocks = (lines) => {
    const blocks = [];
    let buf = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      // A new numbered/Q-prefixed question start flushes the current buffer
      if (isQStart(lines[i]) && buf.length > 0) {
        // Only flush if buf already has some option/ans content (not just continuation text)
        const bufHasOpt = buf.some(b => isOpt(b.trim()) || isAns(b.trim()));
        if (bufHasOpt) {
          blocks.push(buf.join("\n"));
          buf = [];
        }
      }
      buf.push(lines[i]);
    }
    if (buf.length) blocks.push(buf.join("\n"));
    return blocks.map(b => b.trim()).filter(Boolean);
  };

  // First try blank-line split; then for each resulting block, re-split if it
  // contains multiple question-start lines (handles mixed blank/no-blank docs)
  const blankBlocks = preText.split(/\n[ \t]*\n+/).map(b => b.trim()).filter(Boolean);
  const rawBlocks = blankBlocks.flatMap(block => {
    const lines = block.split("\n");
    const qStartCount = lines.filter(l => isQStart(l)).length;
    if (qStartCount > 1) {
      // This blank-block contains multiple questions — re-split it
      return splitIntoBlocks(lines);
    }
    return [block];
  });

  // Fallback: if still only 1 block, try full line-by-line split
  const finalBlocks = (rawBlocks.length > 1)
    ? rawBlocks
    : splitIntoBlocks(allLines);

  // ── Parse one block ───────────────────────────────────────────────────────
  const parseBlock = (block) => {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    let q = "", options = ["","","",""], ans = 0, foundAns = false;
    for (const line of lines) {
      const am = line.match(ANS_RE);
      if (am) { ans = mapLetter(am[1]); foundAns = true; continue; }
      if (isOpt(line)) {
        const parts = getOptParts(line);
        if (!parts) continue;
        const oi = mapLetter(parts[0]); const txt = parts[1].trim();
        if (txt && oi >= 0 && oi <= 3) options[oi] = txt;
        continue;
      }
      // Accumulate question text (may span multiple lines)
      if (!q) q = line.replace(QSTRIP, "").trim();
      else if (!isQStart(line)) q += " " + line; // continuation line
    }
    return { q: q.trim(), options, ans, _hasAns: foundAns };
  };

  return finalBlocks.map((block, idx) => {
    const item = parseBlock(block);
    if (ansLines[idx]) { item.ans = mapLetter(ansLines[idx][0]); item._hasAns = true; }
    return item;
  }).filter(item => item.q && item.options.some(o => o));
};

// ── Lecturer: CBT Exam Manager ───────────────────────────────────────
