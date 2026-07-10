/**
 * Shared PDF utility helpers for generating branded PDF documents.
 * Uses jsPDF + jspdf-autotable (must be installed in the consuming project).
 */

import jsPDF from "jspdf";
import "jspdf-autotable";
import { fmtDate } from "@/components/ledger-ui";

// ── Cached logo loader ──

let _logoPromise: Promise<string> | null = null;

export function resetLogoCache() {
  _logoPromise = null;
}

/**
 * Load the company logo (/logo.png) and return it as a base64 data URL.
 * The result is cached so subsequent calls resolve immediately.
 */
export async function getLogoBase64(): Promise<string> {
  if (_logoPromise) return _logoPromise;
  _logoPromise = new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Could not get canvas context")); return; }
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load logo"));
    img.src = "/logo.png";
  });
  return _logoPromise;
}

// ── PDF Helpers ──

/**
 * Draw a page number footer on every page of the document.
 */
export function drawPdfFooter(doc: jsPDF) {
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(
      `Page ${i} of ${pageCount} · Generated ${new Date().toLocaleString()}`,
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height - 10,
      { align: "center" },
    );
  }
}

/**
 * Draw a professional dark-blue header bar at the top of the first page.
 * Includes the company logo (if provided) on the left, title + subtitle to the right.
 */
export function drawPdfHeaderBar(doc: jsPDF, title: string, subtitle: string, logoBase64?: string) {
  const pw = doc.internal.pageSize.width;
  // Dark header bar
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pw, 32, "F");

  if (logoBase64) {
    try {
      doc.addImage(logoBase64, "PNG", 12, 6, 36, 20);
    } catch {
      // Silently fall back
    }
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text(title, 54, 14);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(subtitle, 54, 23);
  } else {
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text(title, 14, 16);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(subtitle, 14, 25);
  }
}

/** Format money for PDF display: $X,XXX.XX */
export function pdfMoney(val: number | null | undefined): string {
  if (val == null) return "—";
  return "$" + Number(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Format a date for PDF display (or "—" if null) */
export function pdfDate(val: string | null | undefined): string {
  if (!val) return "—";
  return fmtDate(val);
}

/** Draw a labelled detail line in a two-column layout */
export function pdfDetail(doc: jsPDF, label: string, value: string, x: number, y: number, labelWidth = 40) {
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(100, 116, 139);
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 41, 59);
  doc.text(value, x + labelWidth, y);
}

/** Draw a section heading with a thin underline */
export function pdfSectionHeading(doc: jsPDF, title: string, x: number, y: number, width: number) {
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 64, 175);
  doc.text(title, x, y);
  doc.setDrawColor(200, 200, 200);
  doc.line(x, y + 1.5, x + width, y + 1.5);
}
