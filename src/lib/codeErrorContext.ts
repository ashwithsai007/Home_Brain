// src/lib/codeErrorContext.ts

export type CodeContextResult = {
    used: boolean;
    reason: string;
    extractedPrompt: string; // what we send outward (before broker sanitize)
  };
  
  type StackHit =
    | { kind: "node"; file?: string; line?: number; col?: number; raw: string }
    | { kind: "python"; file?: string; line?: number; raw: string }
    | { kind: "java"; file?: string; line?: number; raw: string };
  
  function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n));
  }
  
  function baseName(p?: string) {
    if (!p) return "";
    const s = p.replace(/\\/g, "/");
    return s.split("/").pop() || s;
  }
  
  function extractFencedCodeBlocks(text: string) {
    const blocks: { lang: string; code: string }[] = [];
    const re = /```(\w+)?\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      blocks.push({
        lang: String(m[1] || "").toLowerCase(),
        code: String(m[2] || ""),
      });
    }
    return blocks;
  }
  
  function detectStackText(text: string) {
    const lines = text.split("\n");
    const keep = lines.filter((l) =>
      /(at\s+.+\(.+:\d+:\d+\))|(at\s+.+:\d+:\d+)|(File\s+".+",\s+line\s+\d+)|(\s+at\s+.+\(.+:\d+\))/.test(
        l
      )
    );
    return keep.join("\n").trim();
  }
  
  function parseStackHits(stackText: string): StackHit[] {
    const hits: StackHit[] = [];
    let m: RegExpExecArray | null;
  
    // Node: at fn (/path/file.ts:12:34)
    const node1 = /at\s+.+\((.+):(\d+):(\d+)\)/g;
    while ((m = node1.exec(stackText))) {
      hits.push({ kind: "node", file: m[1], line: Number(m[2]), col: Number(m[3]), raw: m[0] });
    }
  
    // Node: at /path/file.ts:12:34
    const node2 = /at\s+(.+):(\d+):(\d+)/g;
    while ((m = node2.exec(stackText))) {
      hits.push({ kind: "node", file: m[1], line: Number(m[2]), col: Number(m[3]), raw: m[0] });
    }
  
    // Python: File "x.py", line 123
    const py = /File\s+"([^"]+)",\s+line\s+(\d+)/g;
    while ((m = py.exec(stackText))) {
      hits.push({ kind: "python", file: m[1], line: Number(m[2]), raw: m[0] });
    }
  
    // Java: at pkg.Class.method(File.java:123)
    const jv = /\s+at\s+.+\(([^:]+):(\d+)\)/g;
    while ((m = jv.exec(stackText))) {
      hits.push({ kind: "java", file: m[1], line: Number(m[2]), raw: m[0] });
    }
  
    return hits;
  }
  
  function findExplicitLineHint(text: string): number | null {
    const m = /\b(?:line|ln)\s+(\d{1,6})\b/i.exec(text);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  
  function findInlineMarkerLine(code: string): number | null {
    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/(>>>\s*)|(\bERROR\s+HERE\b)/i.test(l)) return i + 1;
    }
    return null;
  }
  
  function findCaretMarkerLine(code: string): number | null {
    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/\^\^\^+/.test(lines[i])) {
        return i; // previous line number (1-based is i)
      }
    }
    return null;
  }
  
  function parseNumberedLines(code: string) {
    // "42 | const x = ..." OR "42: const x = ..."
    const lines = code.split("\n");
    const parsed = lines.map((l) => {
      const m = /^\s*(\d{1,6})\s*(?:\||:)\s?(.*)$/.exec(l);
      if (!m) return null;
      return { n: Number(m[1]), text: m[2] ?? "" };
    });
  
    const ok = parsed.filter(Boolean).length >= Math.max(6, Math.floor(lines.length * 0.25));
    if (!ok) return null;
  
    return parsed.filter(Boolean) as { n: number; text: string }[];
  }
  
  function addLineNumbers(code: string) {
    const lines = code.split("\n");
    return lines.map((l, i) => `${i + 1} | ${l}`).join("\n");
  }
  
  function stripComments(line: string) {
    let out = line;
    out = out.replace(/\/\/.*$/g, "");
    out = out.replace(/#.*$/g, "");
    out = out.replace(/\/\*.*?\*\//g, "");
    return out;
  }
  
  function abstractCodeLine(line: string) {
    let out = line;
  
    out = stripComments(out);
  
    // Replace string literals (best-effort; main sanitizer also does this)
    out = out.replace(/`([^`\\]|\\.)*`/g, "`[STR]`");
    out = out.replace(/"([^"\\]|\\.)*"/g, '"[STR]"');
    out = out.replace(/'([^'\\]|\\.)*'/g, "'[STR]'");
  
    // Mask long numbers
    out = out.replace(/\b\d{2,}\b/g, "0");
  
    // Collapse whitespace
    out = out.replace(/\s+/g, " ").trim();
  
    return out;
  }
  
  function buildContextFromNumbered(items: { n: number; text: string }[], targetLine: number, radius = 5) {
    const min = targetLine - radius;
    const max = targetLine + radius;
  
    const picked = items.filter((x) => x.n >= min && x.n <= max);
    const lines = picked.map((x) => {
      const marker = x.n === targetLine ? ">>> " : "    ";
      return `${marker}${x.n} | ${abstractCodeLine(x.text)}`;
    });
  
    return lines.join("\n").trim();
  }
  
  function buildFallbackContextFromRaw(code: string, radius = 5) {
    const lines = code.split("\n");
    const total = lines.length;
    const chunk = radius * 2 + 1;
  
    const start = clamp(Math.floor(total * 0.5), 0, Math.max(0, total - chunk));
    const slice = lines.slice(start, start + chunk);
  
    return slice
      .map((l, i) => {
        const n = start + i + 1;
        return `    ${n} | ${abstractCodeLine(l)}`;
      })
      .join("\n")
      .trim();
  }
  
  function chooseBestBlock(blocks: { lang: string; code: string }[], hits: StackHit[]) {
    const preferredLang = new Set(["ts", "tsx", "js", "jsx", "py", "java"]);
    const fileBase = baseName(hits[0]?.file);
  
    let best = blocks[0];
    let bestScore = -1;
  
    for (const b of blocks) {
      let score = 0;
      if (preferredLang.has(b.lang)) score += 2;
  
      if (fileBase) {
        const lc = b.code.toLowerCase();
        const fb = fileBase.toLowerCase();
        if (lc.includes(fb)) score += 6;
      }
  
      score += Math.min(2, Math.floor(b.code.length / 1500));
  
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
  
    return best;
  }
  
  export function buildCodeErrorPrompt(userText: string): CodeContextResult {
    const text = String(userText || "");
    const blocks = extractFencedCodeBlocks(text);
  
    const looksLikeError =
      /\b(error|exception|traceback|stack trace|TypeError|ReferenceError|SyntaxError|NullPointerException)\b/i.test(
        text
      );
  
    if (!looksLikeError || blocks.length === 0) {
      return { used: false, reason: "No clear code+error pattern found", extractedPrompt: text };
    }
  
    const stackText = detectStackText(text);
    const hits = parseStackHits(stackText);
    const explicitLine = findExplicitLineHint(text);
  
    const picked = chooseBestBlock(blocks, hits);
  
    // Ensure numbered
    const numberedCode = parseNumberedLines(picked.code) ? picked.code : addLineNumbers(picked.code);
    const numbered = parseNumberedLines(numberedCode);
  
    const markerLine = findInlineMarkerLine(picked.code) ?? findCaretMarkerLine(picked.code) ?? null;
  
    const target =
      explicitLine ??
      markerLine ??
      hits.find((h) => typeof (h as any).line === "number")?.line ??
      null;
  
    let context = "";
    if (numbered && target) {
      context = buildContextFromNumbered(numbered, target, 5);
    } else if (numbered && !target) {
      const mid = numbered[Math.floor(numbered.length / 2)]?.n ?? numbered[0].n;
      context = buildContextFromNumbered(numbered, mid, 5);
    } else {
      context = buildFallbackContextFromRaw(picked.code, 5);
    }
  
    const errorHeader = stackText
      ? `Stack / Trace (trimmed):\n${stackText.split("\n").slice(0, 12).join("\n")}`
      : `Error description:\n${text.split("\n").slice(0, 10).join("\n")}`;
  
    const extractedPrompt =
      `I’m debugging an error.\n\n` +
      `${errorHeader}\n\n` +
      `Code context (minimal + abstracted):\n\`\`\`${picked.lang || "text"}\n${context}\n\`\`\`\n\n` +
      `Give the most likely cause and fix.\n` +
      `If you need more, ask ONLY targeted questions about the immediate surrounding lines (do not request full source).`;
  
    return {
      used: true,
      reason: "Extracted minimal context around likely error line",
      extractedPrompt,
    };
  }