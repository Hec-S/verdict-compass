import * as pdfjs from "pdfjs-dist";
// @ts-ignore - Vite worker import
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
}

export const MAX_CHARS = 80_000;

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
 * Aggressively strip court-reporter formatting noise to shrink payload.
 */
export function cleanTranscript(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.trim())
    // Remove pure line-number lines (1-4 digit standalone numbers)
    .filter((line) => !/^\d{1,4}$/.test(line))
    // Remove court reporter certificate boilerplate
    .filter(
      (line) =>
        !line.match(
          /shantel|zambrano|CSR No|reporter'?s certificate|expiration date|official court reporter/i,
        ),
    )
    // Remove blank lines
    .filter((line) => line.length > 0)
    .join(" ")
    // Collapse multiple spaces
    .replace(/\s+/g, " ")
    .trim();
}

export function combineAndCap(parts: ExtractedPdf[]): { text: string; truncated: boolean } {
  const combined = parts
    .map((p) => `=== FILE: ${p.name} (${p.pages} pages) ===\n${p.text}`)
    .join("\n\n");
  if (combined.length <= MAX_CHARS) return { text: combined, truncated: false };
  return { text: combined.slice(0, MAX_CHARS), truncated: true };
}