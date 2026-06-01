import jsPDF from "jspdf";
import QRCode from "qrcode";

export interface CertificatePdfData {
  certificateId: string;
  projectName: string;
  createdAt: string;
  ownerEmail?: string | null;
}

export async function generateCertificatePdf(data: CertificatePdfData): Promise<Blob> {
  const verifyUrl = `${window.location.origin}/verify/${data.certificateId}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 0, width: 240 });

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // Parchment fill
  doc.setFillColor(248, 245, 235);
  doc.rect(0, 0, W, H, "F");

  // Inner border (navy)
  doc.setDrawColor(28, 36, 70);
  doc.setLineWidth(2);
  doc.rect(28, 28, W - 56, H - 56);
  doc.setLineWidth(0.5);
  doc.rect(36, 36, W - 72, H - 72);

  // Header
  doc.setTextColor(28, 36, 70);
  doc.setFont("times", "italic");
  doc.setFontSize(40);
  doc.text("Certificate of Authenticity", W / 2, 110, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 90);
  doc.text("PROOFOFHUMAN  ·  HUMAN-PROCESS VERIFICATION REGISTRY", W / 2, 134, { align: "center" });

  // Subject
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
  doc.text("and lodged with the ProofOfHuman registry on the date below.", W / 2, 286, {
    align: "center",
  });

  // Date + owner
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

  // Certificate ID
  doc.setFont("courier", "bold");
  doc.setFontSize(20);
  doc.setTextColor(28, 36, 70);
  doc.text(data.certificateId, 80, H - 75);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 120);
  doc.text("Certificate ID — verify at", 80, H - 60);
  doc.text(verifyUrl, 80, H - 48);

  // Gold seal
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

  // QR code
  doc.addImage(qrDataUrl, "PNG", W - 220, 60, 88, 88);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 120);
  doc.text("Scan to verify", W - 176, 160, { align: "center" });

  return doc.output("blob");
}
