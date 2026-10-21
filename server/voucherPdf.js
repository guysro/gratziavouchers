import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const voucherTemplatePath = path.resolve(
  dirname,
  "..",
  "private",
  "voucherNew.pdf",
);
const voucherFontPath = path.resolve(
  dirname,
  "..",
  "private",
  "fonts",
  "NotoSansHebrew.ttf",
);

function toVisualHebrewOrder(value) {
  if (!/[\u0590-\u05ff]/u.test(value)) return value;

  return Array.from(
    new Intl.Segmenter("he", { granularity: "grapheme" }).segment(value),
    ({ segment }) => segment,
  )
    .reverse()
    .join("");
}

function formatExpirationDate(createdAt) {
  const expiry = new Date(createdAt);
  if (Number.isNaN(expiry.getTime())) {
    throw new Error("Invalid voucher creation date.");
  }
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  const day = String(expiry.getUTCDate()).padStart(2, "0");
  const month = String(expiry.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${expiry.getUTCFullYear()}`;
}

export async function createVoucherPdf(voucher) {
  const [templateBytes, fontBytes] = await Promise.all([
    readFile(voucherTemplatePath),
    readFile(voucherFontPath),
  ]);
  const pdf = await PDFDocument.load(templateBytes);
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const page = pdf.getPages()[0];
  const textValues = [
    { text: toVisualHebrewOrder(`${voucher.amount} ₪`), x: 400, size: 14 },
    { text: voucher.voucherCode, x: 220, size: 12 },
    {
      text: formatExpirationDate(voucher.createdAt),
      x: 65,
      size: 12,
    },
  ];

  for (const { text, x, size } of textValues) {
    page.drawText(text, {
      x,
      y: 100,
      size,
      font,
      color: rgb(0.11, 0.337, 0.263),
    });
  }

  return pdf.save();
}
