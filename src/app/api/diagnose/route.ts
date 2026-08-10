/**
 * POST /api/diagnose — TEMPORARY.
 *
 * Reports what PDF rendering actually does inside the deployed container,
 * because two attempts at fixing a production-only rendering failure were
 * reasoned out rather than measured, and both were wrong.
 *
 * Delete this once the cause is known. It is behind the passcode like
 * everything else, and it returns no receipt content — only whether pixels
 * appeared and how many fonts exist.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Fraction of pixels that aren't white. Blank pages score ~0. */
function inkRatio(pixels: Uint8ClampedArray): number {
  let ink = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] < 240 || pixels[i + 1] < 240 || pixels[i + 2] < 240) ink++;
  }
  return ink / (pixels.length / 4);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.getAll("files").find((f): f is File => f instanceof File);

  const canvas = await import("@napi-rs/canvas");
  const { GlobalFonts, createCanvas } = canvas;

  const before = GlobalFonts.families.length;

  // Did the bundled font actually reach the container, and does registering
  // it work? This is the thing two failed fixes never established.
  const { existsSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const nodePath = await import("node:path");
  let fontFilePresent = false;
  let fontDir = "unresolved";
  try {
    const require_ = createRequire(import.meta.url);
    fontDir = nodePath.dirname(
      require_.resolve("@fontsource/dejavu-sans/package.json"),
    );
    fontFilePresent = existsSync(
      nodePath.join(fontDir, "files/dejavu-sans-latin-400-normal.woff"),
    );
  } catch (e) {
    fontDir = `resolve failed: ${String(e).slice(0, 60)}`;
  }

  const { ensureFonts } = await import("@/lib/receipts/extract");
  await ensureFonts();

  const fonts = {
    familyCountBefore: before,
    familyCountAfterRegistering: GlobalFonts.families.length,
    fontPackageDir: fontDir.replace(/^.*node_modules/, "…/node_modules"),
    fontFileShipped: fontFilePresent,
    sample: GlobalFonts.families.slice(0, 6).map((f) => f.family),
  };

  // 2. Can the canvas draw text by itself, independent of pdf.js?
  const c = createCanvas(300, 100);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 300, 100);
  ctx.fillStyle = "#000";
  ctx.font = "36px sans-serif";
  ctx.fillText("Test 12345", 10, 60);
  const plainText = inkRatio(ctx.getImageData(0, 0, 300, 100).data);

  // 3. And with a font name a PDF would ask for?
  const c2 = createCanvas(300, 100);
  const ctx2 = c2.getContext("2d");
  ctx2.fillStyle = "#fff";
  ctx2.fillRect(0, 0, 300, 100);
  ctx2.fillStyle = "#000";
  ctx2.font = '36px "EAAAAC+Arial-BoldMT"';
  ctx2.fillText("Test 12345", 10, 60);
  const pdfFontName = inkRatio(ctx2.getImageData(0, 0, 300, 100).data);

  // 4. What does pdf.js actually produce for a real page?
  let pdfRender: Record<string, unknown> = { skipped: "no file supplied" };
  if (file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { getDocumentProxy, renderPageAsImage } = await import("unpdf");

    const results: Record<string, number> = {};
    for (const disableFontFace of [false, true]) {
      try {
        const doc = await getDocumentProxy(new Uint8Array(bytes), {
          disableFontFace,
        });
        const png = await renderPageAsImage(doc, 1, {
          scale: 2,
          canvasImport: () => import("@napi-rs/canvas") as never,
        });
        const img = await canvas.loadImage(Buffer.from(png as ArrayBuffer));
        const out = createCanvas(img.width, img.height);
        const octx = out.getContext("2d");
        octx.drawImage(img, 0, 0);
        results[`disableFontFace_${disableFontFace}`] = Number(
          inkRatio(octx.getImageData(0, 0, img.width, img.height).data).toFixed(5),
        );
      } catch (e) {
        results[`disableFontFace_${disableFontFace}_error`] = -1;
        results[String(e).slice(0, 80)] = -1;
      }
    }
    pdfRender = results;
  }

  return NextResponse.json({
    node: process.version,
    fonts,
    canvasInk: {
      genericSansSerif: Number(plainText.toFixed(5)),
      pdfStyleFontName: Number(pdfFontName.toFixed(5)),
      note: "0 means nothing was drawn",
    },
    pdfRender,
  });
}
