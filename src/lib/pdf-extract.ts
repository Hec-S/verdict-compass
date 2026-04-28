import * as pdfjs from "pdfjs-dist";
// @ts-ignore - Vite worker import
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
}

export const MAX_CHARS = 100_000;

export interface ExtractedPdf {
  name: string;
  text: string;
  pages: number;
}

export async function extractPdfText(file: File): Promise<ExtractedPdf> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it: any) => ("str" in it ? it.str : ""))
      .join(" ");
    text += `\n\n--- Page ${i} ---\n${pageText}`;
  }
  if (!text.trim()) {
    throw new Error(
      `Could not read "${file.name}". Please ensure it is a text-based PDF, not a scanned image.`,
    );
  }
  return { name: file.name, text: cleanTranscript(text), pages: doc.numPages };
}

/**
 * Strip court-reporter formatting noise to shrink payload:
 * - Line numbers (1-2 digits at start of a line, common transcript format)
 * - Reporter certificate / certification pages at the end
 * - Repeated whitespace and blank lines
 */
export function cleanTranscript(raw: string): string {
  let s = raw;

  // Cut reporter certificate sections (everything from common cert markers onward)
  const certPatterns = [
    /\n[^\n]*reporter['\u2019]?s\s+certificate[\s\S]*$/i,
    /\nCERTIFICATE\s+OF\s+(?:REPORTER|OFFICIAL\s+REPORTER)[\s\S]*$/i,
    /\nI,\s+[^,]+,\s+(?:Certified\s+Shorthand|Official\s+Court)\s+Reporter[\s\S]*$/i,
  ];
  for (const re of certPatterns) s = s.replace(re, "");

  // Strip leading line numbers like " 1 ", "12 ", "  3  " at start of lines
  s = s.replace(/^[ \t]*\d{1,2}[ \t]+/gm, "");

  // Collapse multiple whitespace characters within lines
  s = s.replace(/[ \t]+/g, " ");

  // Remove blank lines (and trim)
  s = s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");

  return s.trim();
}

export function combineAndCap(parts: ExtractedPdf[]): { text: string; truncated: boolean } {
  const combined = parts
    .map((p) => `=== FILE: ${p.name} (${p.pages} pages) ===\n${p.text}`)
    .join("\n\n");
  if (combined.length <= MAX_CHARS) return { text: combined, truncated: false };
  return { text: combined.slice(0, MAX_CHARS), truncated: true };
}