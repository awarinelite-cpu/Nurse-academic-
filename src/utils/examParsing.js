export function robustParseQuestions(pasteText, pasteAnswers) {
  const text = (pasteText||"").trim();
  const ansLines = (pasteAnswers||"").trim().split("\n").map(l=>l.trim()).filter(Boolean);
  if (!text) return [];

  const lines = text.split("\n");
  const blocks = [];
  let cur = [];

  // Detect the start of a new question
  const isQStart = (line) =>
    /^\d{1,3}[\.\)]\s+\S/.test(line) ||          // "1. text" / "1) text"
    /^Q\s*\d*\s*[:\.\-]\s*\S/i.test(line) ||     // "Q:" / "Q1:" / "Q 1."
    /^Question\s*\d*\s*[:\.\-]\s*\S/i.test(line);// "Question 1:"

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { if (cur.length) cur.push(""); continue; }

    if (isQStart(line) && cur.length > 0) {
      // End current block if it already has option lines or an answer
      const hasOpts = cur.some(l => /^[A-D][\.\)\s:]/i.test(l));
      const hasAns  = cur.some(l => /^(?:ans|answer)\s*[:\.\)]/i.test(l));
      if (hasOpts || hasAns) { blocks.push([...cur]); cur = []; }
    }
    cur.push(line);
    // End block immediately after an inline answer line
    if (/^(?:ANS(?:WER)?)\s*[:\.\)]\s*[A-D]/i.test(line)) {
      blocks.push([...cur]); cur = [];
    }
  }
  if (cur.some(l=>l.trim())) blocks.push(cur);

  return blocks.map((blockLines, idx) => {
    const clean = blockLines.map(l=>l.trim()).filter(Boolean);
    let q = "", options = ["","","",""], ans = 0;
    let qLines = [], inQ = true;

    clean.forEach(line => {
      // Inline answer: "Answer: B" / "ANS: B" / "Ans: B"
      const ansM = line.match(/^(?:ANS(?:WER)?)\s*[:\.\)]\s*([A-D])/i);
      if (ansM) { ans = "ABCD".indexOf(ansM[1].toUpperCase()); if(ans<0) ans=0; inQ=false; return; }

      // Option line: "A. text" / "A) text" / "A: text" / "(A) text"
      const optM = line.match(/^\(?([A-D])\)?[\.\)\s:]\s*(.+)$/i);
      if (optM) {
        const idx2 = "ABCD".indexOf(optM[1].toUpperCase());
        if (idx2 >= 0) { options[idx2] = optM[2].trim(); inQ = false; return; }
      }

      // "Q: text" or "Q1: text" prefix — strip prefix, rest is question
      const qM = line.match(/^(?:Q\s*\d*\s*[:\.\-]|Question\s*\d*\s*[:\.\-])\s*(.+)$/i);
      if (qM) { qLines.push(qM[1].trim()); inQ = true; return; }

      // "1. text" / "1) text" — strip number
      const numM = line.match(/^\d{1,3}[\.\)]\s+(.+)$/);
      if (numM && inQ) { qLines.push(numM[1].trim()); return; }

      if (inQ) qLines.push(line);
    });

    q = qLines.join(" ").trim();

    // Use separate answer column if provided and no inline answer was found
    if (ansLines[idx]) {
      const a = "ABCD".indexOf(ansLines[idx][0]?.toUpperCase());
      if (a >= 0) ans = a;
    }

    return { id: Date.now()+idx, q, options, ans, cat: "General" };
  }).filter(item => item.q && item.options.some(o => o));
}

export function getDailyMockQuestions(pool) {
  if (!pool || pool.length === 0) return [];
  // Serve ALL questions (up to 250) in a date-seeded shuffle
  const today = new Date();
  const seed = today.getFullYear()*10000 + (today.getMonth()+1)*100 + today.getDate();
  const count = Math.min(250, pool.length);
  const arr = [...pool];
  // Fisher-Yates with deterministic seed
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.abs((seed * (i + 1) * 2654435761) >> 0) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}
