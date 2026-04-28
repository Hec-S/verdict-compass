import * as pdfjs from "pdfjs-dist";
// @ts-ignore - Vite worker import
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
}

export const MAX_CHARS = 150_000;

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
  return { name: file.name, text: text.trim(), pages: doc.numPages };
}

export function combineAndCap(parts: ExtractedPdf[]): { text: string; truncated: boolean } {
  const combined = parts
    .map((p) => `=== FILE: ${p.name} (${p.pages} pages) ===\n${p.text}`)
    .join("\n\n");
  if (combined.length <= MAX_CHARS) return { text: combined, truncated: false };
  return { text: combined.slice(0, MAX_CHARS), truncated: true };
}