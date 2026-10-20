import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import type { CompletedVoucher } from "../types/voucher";

async function fetchAsset(path: string): Promise<Uint8Array> {
  const baseUrl = import.meta.env?.BASE_URL ?? "/";
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`Unable to load voucher PDF asset: ${path}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function toVisualHebrewOrder(value: string): string {
  if (!/[\u0590-\u05ff]/u.test(value)) return value;

  return Array.from(
    new Intl.Segmenter("he", { granularity: "grapheme" }).segment(value),
    ({ segment }) => segment,
  )
    .reverse()
    .join("");
}

function formatDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function calculateExpirationDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid voucher purchase date: ${value}`);
  }

  const expiry = new Date(parsed);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  return formatDate(expiry);
}

export async function createVoucherPdf(
  voucher: CompletedVoucher,
): Promise<Uint8Array> {
  const [templateBytes, fontBytes] = await Promise.all([
    fetchAsset("voucherNew.pdf"),
    fetchAsset("fonts/NotoSansHebrew.ttf"),
  ]);
  const pdf = await PDFDocument.load(templateBytes);
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const page = pdf.getPages()[0];

  const textValues = [
    { text: toVisualHebrewOrder(`${voucher.amount} ₪`), x: 400, size: 14 },
    { text: voucher.voucherCode, x: 220, size: 12 },
    { text: calculateExpirationDate(voucher.date), x: 65, size: 12 },
  ];
  const color = rgb(0.11, 0.337, 0.263);

  for (const { text, x, size } of textValues) {
    page.drawText(text, {
      x,
      y: 100,
      size,
      font,
      color,
    });
  }

  return pdf.save();
}
