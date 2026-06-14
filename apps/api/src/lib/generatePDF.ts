import PDFDocument from "pdfkit";

export interface BookingConfirmationData {
  bookingId: string;
  trekkerName: string;
  trekkerEmail: string;
  trekkerPhone: string;
  packageTitle: string;
  agencyName: string;
  agencyEmail: string;
  agencyPhone: string;
  departureDate: Date;
  durationDays: number;
  groupSize: number;
  totalPrice: number;
  currency: string;
  assignedGuideName: string | null;
  assignedGuidePhone: string | null;
  addOns: Array<{ name: string; quantity: number; price: number }>;
  itinerary: Array<{ dayNumber: number; location: string; description: string }>;
  paidAt: Date;
}

export async function generateBookingConfirmationPDF(
  data: BookingConfirmationData
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

// header
    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .text("Booking Confirmation", { align: "center" });

    doc
      .fontSize(11)
      .font("Helvetica")
      .text(data.agencyName, { align: "center" })
      .moveDown(0.3)
      .text(`${data.agencyEmail}  |  ${data.agencyPhone}`, { align: "center" })
      .moveDown(1.5);

    doc
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .strokeColor("#CCCCCC")
      .stroke()
      .moveDown(1);

// booking summary
      doc.fontSize(12).font("Helvetica-Bold").text("Booking Summary").moveDown(0.5);

    const summaryRows: [string, string][] = [
      ["Booking ID", data.bookingId],
      ["Package", data.packageTitle],
      ["Departure Date", data.departureDate.toDateString()],
      ["Duration", `${data.durationDays} days`],
      ["Group Size", `${data.groupSize} person(s)`],
      ["Total Paid", `${data.currency} ${data.totalPrice.toFixed(2)}`],
      ["Payment Date", data.paidAt.toDateString()],
    ];

    doc.fontSize(11).font("Helvetica");
    for (const [label, value] of summaryRows) {
      doc.text(`${label}:`, { continued: true, width: 160 }).text(value);
    }

    doc.moveDown(1);

// trekker details
    doc.fontSize(12).font("Helvetica-Bold").text("Trekker Details").moveDown(0.5);

    doc.fontSize(11).font("Helvetica");
    doc.text(`Name: ${data.trekkerName}`);
    doc.text(`Email: ${data.trekkerEmail}`);
    doc.text(`Phone: ${data.trekkerPhone}`);
    doc.moveDown(1);

// assigned guide
    doc.fontSize(12).font("Helvetica-Bold").text("Assigned Guide").moveDown(0.5);
    doc.fontSize(11).font("Helvetica");

    if (data.assignedGuideName) {
      doc.text(`Name: ${data.assignedGuideName}`);
      if (data.assignedGuidePhone) {
        doc.text(`Phone: ${data.assignedGuidePhone}`);
      }
    } else {
      doc.text("Guide assignment pending — you will be notified shortly.");
    }

    doc.moveDown(1);

// add-ons
    if (data.addOns.length > 0) {
      doc.fontSize(14).font("Helvetica-Bold").text("Add-Ons").moveDown(0.5);
      doc.fontSize(11).font("Helvetica");

      for (const addOn of data.addOns) {
        doc.text(
          `• ${addOn.name}  x${addOn.quantity}  —  ${data.currency} ${(addOn.price * addOn.quantity).toFixed(2)}`
        );
      }

      doc.moveDown(1);
    }

    // itinerary
    if (data.itinerary.length > 0) {
      doc.addPage();
      doc.fontSize(14).font("Helvetica-Bold").text("Day-by-Day Itinerary").moveDown(0.5);

      for (const day of data.itinerary) {
        doc
          .fontSize(12)
          .font("Helvetica-Bold")
          .text(`Day ${day.dayNumber} — ${day.location}`)
          .moveDown(0.2);

        doc
          .fontSize(11)
          .font("Helvetica")
          .text(day.description ?? "")
          .moveDown(0.8);
      }
    }

    // footer
    doc.moveDown(2);
    doc
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .strokeColor("#CCCCCC")
      .stroke()
      .moveDown(0.5);

    doc
      .fontSize(9)
      .fillColor("#888888")
      .text(
        `Generated on ${new Date().toDateString()} · Funtush Global Ecosystem Platform`,
        { align: "center" }
      );

    doc.end();
  });
}
