import jsPDF from "jspdf";
import QRCode from "qrcode";
import { PDFDocument } from "pdf-lib";

export interface VerificationCheck {
  key: string;
  label: string;
  passed: boolean;
  confidence: "low" | "medium" | "high";
  reason: string;
}

export interface CertificatePdfData {
  certificateId: string;
  projectName: string;
  createdAt: string;
  ownerEmail?: string | null;
  checks?: VerificationCheck[];
  summary?: string;
  /** Override origin used for the verify link/QR. Required when running in non-browser environments. */
  baseUrl?: string;
}

async function buildCertificatePdfBytes(data: CertificatePdfData): Promise<Uint8Array> {
  const origin =
    data.baseUrl ??
    (typeof window !== "undefined" ? window.location.origin : "https://bio-mark.ca");
  const verifyUrl = `${origin}/verify/${data.certificateId}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 0, width: 240 });

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  doc.setFillColor(248, 245, 235);
  doc.rect(0, 0, W, H, "F");

  doc.setDrawColor(28, 36, 70);
  doc.setLineWidth(2);
  doc.rect(28, 28, W - 56, H - 56);
  doc.setLineWidth(0.5);
  doc.rect(36, 36, W - 72, H - 72);

  doc.setTextColor(28, 36, 70);
  doc.setFont("times", "italic");
  doc.setFontSize(40);
  doc.text("Certificate of Authenticity", W / 2, 110, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 90);
  doc.text("BIO MARK  ·  HUMAN-PROCESS VERIFICATION REGISTRY", W / 2, 134, { align: "center" });

  doc.setFontSize(13);
  doc.setTextColor(60, 60, 70);
  doc.text("This certifies that the digital work titled", W / 2, 190, { align: "center" });

  doc.setFont("times", "bold");
  doc.setFontSize(28);
  doc.setTextColor(28, 36, 70);
  doc.text(data.projectName, W / 2, 232, { align: "center", maxWidth: W - 200 });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(60, 60, 70);
  doc.text(
    "was created through a recorded human process, captured via screen and webcam,",
    W / 2,
    268,
    { align: "center" },
  );
  doc.text("and lodged with the Bio Mark registry on the date below.", W / 2, 286, {
    align: "center",
  });

  const date = new Date(data.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  doc.setFontSize(12);
  doc.text(`Issued: ${date}`, 80, H - 130);
  if (data.ownerEmail) {
    doc.text(`Owner: ${data.ownerEmail}`, 80, H - 110);
  }

  doc.setFont("courier", "bold");
  doc.setFontSize(20);
  doc.setTextColor(28, 36, 70);
  doc.text(data.certificateId, 80, H - 75);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 120);
  doc.text("Certificate ID — verify at", 80, H - 60);
  doc.text(verifyUrl, 80, H - 48);

  doc.setFillColor(188, 152, 64);
  doc.circle(W - 130, H - 110, 42, "F");
  doc.setFillColor(248, 245, 235);
  doc.circle(W - 130, H - 110, 36, "F");
  doc.setDrawColor(188, 152, 64);
  doc.setLineWidth(1);
  doc.circle(W - 130, H - 110, 36);
  doc.setTextColor(28, 36, 70);
  doc.setFont("times", "italic");
  doc.setFontSize(11);
  doc.text("Verified", W - 130, H - 116, { align: "center" });
  doc.text("Human", W - 130, H - 100, { align: "center" });

  doc.addImage(qrDataUrl, "PNG", W - 220, 60, 88, 88);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 120);
  doc.text("Scan to verify", W - 176, 160, { align: "center" });

  // ------- Page 2: Verification checks -------
  if (data.checks && data.checks.length > 0) {
    doc.addPage("letter", "portrait");
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();

    doc.setFillColor(248, 245, 235);
    doc.rect(0, 0, PW, PH, "F");
    doc.setDrawColor(28, 36, 70);
    doc.setLineWidth(1);
    doc.rect(28, 28, PW - 56, PH - 56);

    doc.setTextColor(28, 36, 70);
    doc.setFont("times", "italic");
    doc.setFontSize(26);
    doc.text("Verification Report", PW / 2, 90, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 90);
    doc.text(
      `Certificate ${data.certificateId} · ${data.projectName}`,
      PW / 2,
      110,
      { align: "center" },
    );

    doc.setFontSize(9);
    doc.setTextColor(110, 110, 120);
    doc.text(
      "The following automated checks were performed on the recorded session and the submitted document.",
      PW / 2,
      128,
      { align: "center", maxWidth: PW - 120 },
    );

    let y = 160;
    const leftX = 60;
    const rightX = PW - 60;
    data.checks.forEach((c, i) => {
      const status = c.passed ? "PASS" : "FAIL";
      const statusColor: [number, number, number] = c.passed
        ? [40, 120, 70]
        : [170, 50, 50];

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(28, 36, 70);
      const labelLines = doc.splitTextToSize(`${i + 1}. ${c.label}`, rightX - leftX - 70);
      doc.text(labelLines, leftX, y);

      doc.setTextColor(...statusColor);
      doc.setFontSize(10);
      doc.text(status, rightX, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(110, 110, 120);
      doc.text(`confidence: ${c.confidence}`, rightX, y + 12, { align: "right" });

      const labelH = labelLines.length * 13;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(70, 70, 80);
      const reasonLines = doc.splitTextToSize(c.reason, rightX - leftX - 70);
      doc.text(reasonLines, leftX, y + labelH + 4);

      y += labelH + reasonLines.length * 11 + 18;

      if (y > PH - 100 && i < data.checks!.length - 1) {
        doc.addPage("letter", "portrait");
        doc.setFillColor(248, 245, 235);
        doc.rect(0, 0, PW, PH, "F");
        doc.setDrawColor(28, 36, 70);
        doc.setLineWidth(1);
        doc.rect(28, 28, PW - 56, PH - 56);
        y = 60;
      }
    });

    if (data.summary) {
      if (y > PH - 140) {
        doc.addPage("letter", "portrait");
        doc.setFillColor(248, 245, 235);
        doc.rect(0, 0, PW, PH, "F");
        doc.setDrawColor(28, 36, 70);
        doc.setLineWidth(1);
        doc.rect(28, 28, PW - 56, PH - 56);
        y = 60;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(28, 36, 70);
      doc.text("Summary", leftX, y + 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(70, 70, 80);
      const sumLines = doc.splitTextToSize(data.summary, rightX - leftX);
      doc.text(sumLines, leftX, y + 26);
    }
  }

  return new Uint8Array(doc.output("arraybuffer"));
}

export async function generateCertificatePdf(data: CertificatePdfData): Promise<Blob> {
  const bytes = await buildCertificatePdfBytes(data);
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

/**
 * Merges the user's original document PDF with the certificate page appended at the end.
 */
export async function generateCombinedPdf(
  originalPdf: Blob,
  data: CertificatePdfData,
): Promise<Blob> {
  const originalBytes = new Uint8Array(await originalPdf.arrayBuffer());
  const certBytes = await buildCertificatePdfBytes(data);

  const merged = await PDFDocument.create();
  const originalDoc = await PDFDocument.load(originalBytes);
  const certDoc = await PDFDocument.load(certBytes);

  const originalPages = await merged.copyPages(originalDoc, originalDoc.getPageIndices());
  for (const p of originalPages) merged.addPage(p);
  const certPages = await merged.copyPages(certDoc, certDoc.getPageIndices());
  for (const p of certPages) merged.addPage(p);

  const out = await merged.save();
  return new Blob([out as BlobPart], { type: "application/pdf" });
}
