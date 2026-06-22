// Defer heavy PDF deps (html2canvas ~150KB + jspdf ~200KB) until user clicks Export.
type Html2CanvasFn = (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
type JsPdfCtor = new (opts?: Record<string, unknown>) => {
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
  addImage: (...args: unknown[]) => void;
  addPage: () => void;
  output: (type?: "blob" | "datauristring" | "dataurlstring" | "save") => Blob | string;
};

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const DEFAULT_FILENAME = "简历";
const MIN_SCALE = 2;
const PAGE_OVERFLOW_TOLERANCE_PX = 4;
const SINGLE_PAGE_FIT_MAX_OVERFLOW = 0.12;
const EXPORT_FONT_FAMILY = "CareerForgeResumeExport";

let exportFontSourcesPromise: Promise<{ regular: string; bold: string }> | null = null;

type ProgressState = {
  phase: "render" | "compose" | "download";
  current: number;
  total: number;
  message: string;
};

export type ExportOptions = {
  filename?: string;
  scale?: number;
  onProgress?: (state: ProgressState) => void;
};

function defaultFilename(title: string | undefined | null): string {
  const safe = (title || DEFAULT_FILENAME).replace(/[\\/:*?"<>|]/g, "_").trim();
  return safe || DEFAULT_FILENAME;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function waitForFonts(doc: Document): Promise<void> {
  if (!doc.fonts) return Promise.resolve();
  return doc.fonts.ready.then(() => undefined);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("读取导出字体失败")), {
      once: true,
    });
    reader.readAsDataURL(blob);
  });
}

function loadExportFontSources(): Promise<{ regular: string; bold: string }> {
  if (!exportFontSourcesPromise) {
    exportFontSourcesPromise = Promise.all([
      fetch("/fonts/AlibabaPuHuiTi-3-55-Regular.ttf").then((response) => {
        if (!response.ok) throw new Error("加载简历常规字体失败");
        return response.blob();
      }),
      fetch("/fonts/AlibabaPuHuiTi-3-85-Bold.ttf").then((response) => {
        if (!response.ok) throw new Error("加载简历粗体字体失败");
        return response.blob();
      }),
    ])
      .then(async ([regular, bold]) => ({
        regular: await blobToDataUrl(regular),
        bold: await blobToDataUrl(bold),
      }))
      .catch((error) => {
        exportFontSourcesPromise = null;
        throw error;
      });
  }
  return exportFontSourcesPromise;
}

async function attachExportFonts(): Promise<HTMLStyleElement> {
  const sources = await loadExportFontSources();
  const style = document.createElement("style");
  style.setAttribute("data-resume-export-fonts", "true");
  style.textContent = `
    @font-face {
      font-family: "${EXPORT_FONT_FAMILY}";
      src: url("${sources.regular}") format("truetype");
      font-weight: 400;
      font-style: normal;
      font-display: block;
    }
    @font-face {
      font-family: "${EXPORT_FONT_FAMILY}";
      src: url("${sources.bold}") format("truetype");
      font-weight: 700;
      font-style: normal;
      font-display: block;
    }
  `;
  document.head.appendChild(style);
  await Promise.all([
    document.fonts.load(`400 16px "${EXPORT_FONT_FAMILY}"`),
    document.fonts.load(`700 16px "${EXPORT_FONT_FAMILY}"`),
  ]);
  await waitForFonts(document);
  return style;
}

function waitForImages(root: HTMLElement): Promise<void[]> {
  const imgs = Array.from(root.querySelectorAll("img"));
  return Promise.all(
    imgs.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  );
}

function createExportClone(element: HTMLElement): {
  host: HTMLDivElement;
  clone: HTMLElement;
} {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${A4_WIDTH_MM}mm`,
    minWidth: `${A4_WIDTH_MM}mm`,
    margin: "0",
    padding: "0",
    overflow: "visible",
    pointerEvents: "none",
    background: "#ffffff",
  });

  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.setProperty("display", "block", "important");
  clone.style.setProperty("width", `${A4_WIDTH_MM}mm`, "important");
  clone.style.setProperty("min-width", `${A4_WIDTH_MM}mm`, "important");
  clone.style.setProperty("max-width", `${A4_WIDTH_MM}mm`, "important");
  clone.style.setProperty("min-height", `${A4_HEIGHT_MM}mm`, "important");
  clone.style.setProperty("height", "auto", "important");
  clone.style.setProperty("margin", "0", "important");
  clone.style.setProperty("transform", "none", "important");
  clone.style.setProperty("transform-origin", "top left", "important");
  clone.style.setProperty("zoom", "1", "important");
  clone.style.setProperty("box-shadow", "none", "important");
  clone.style.setProperty("box-sizing", "border-box", "important");
  clone.style.setProperty(
    "font-family",
    `"${EXPORT_FONT_FAMILY}", "PingFang SC", "Microsoft YaHei", sans-serif`,
    "important",
  );

  host.appendChild(clone);
  document.body.appendChild(host);
  return { host, clone };
}

function canvasPageData(
  source: HTMLCanvasElement,
  offsetY: number,
  pageHeightPx: number,
): string {
  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = source.width;
  pageCanvas.height = pageHeightPx;

  const context = pageCanvas.getContext("2d");
  if (!context) throw new Error("无法创建 PDF 页面画布");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

  const sourceHeight = Math.min(pageHeightPx, source.height - offsetY);
  if (sourceHeight > 0) {
    context.drawImage(
      source,
      0,
      offsetY,
      source.width,
      sourceHeight,
      0,
      0,
      source.width,
      sourceHeight,
    );
  }

  return pageCanvas.toDataURL("image/jpeg", 0.95);
}

function fittedSinglePageData(source: HTMLCanvasElement, pageHeightPx: number): string {
  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = source.width;
  pageCanvas.height = pageHeightPx;

  const context = pageCanvas.getContext("2d");
  if (!context) throw new Error("无法创建 PDF 页面画布");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

  const fitScale = Math.min(1, pageHeightPx / source.height);
  const renderWidth = Math.round(source.width * fitScale);
  const renderHeight = Math.round(source.height * fitScale);
  const offsetX = Math.round((pageCanvas.width - renderWidth) / 2);
  context.drawImage(source, offsetX, 0, renderWidth, renderHeight);

  return pageCanvas.toDataURL("image/jpeg", 0.95);
}

/**
 * 将预览 DOM 渲染为 PDF 并触发下载。
 * 使用 html2canvas 拍照 + jsPDF 拼装，与 magic-resume 的主路径一致。
 */
export async function exportResumeElementToPdf(
  element: HTMLElement,
  options: ExportOptions = {},
): Promise<void> {
  const { filename, scale = MIN_SCALE, onProgress } = options;
  const outName = defaultFilename(filename);

  onProgress?.({
    phase: "render",
    current: 0,
    total: 1,
    message: "正在准备渲染资源…",
  });

  const exportFontStyle = await attachExportFonts();
  const { host, clone } = createExportClone(element);
  let canvas: HTMLCanvasElement;

  try {
    await waitForFonts(document);
    await waitForImages(clone);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    onProgress?.({
      phase: "render",
      current: 1,
      total: 2,
      message: "正在渲染 A4 页面…",
    });

    const exportWidth = clone.scrollWidth;
    const exportHeight = clone.scrollHeight;
    const { default: html2canvas } = (await import("html2canvas")) as { default: Html2CanvasFn };
    canvas = await html2canvas(clone, {
      scale: Math.max(MIN_SCALE, scale),
      backgroundColor: "#ffffff",
      useCORS: true,
      allowTaint: true,
      logging: false,
      width: exportWidth,
      height: exportHeight,
      windowWidth: Math.max(exportWidth, document.documentElement.clientWidth),
      windowHeight: Math.max(exportHeight, document.documentElement.clientHeight),
      scrollX: 0,
      scrollY: 0,
    });
  } finally {
    host.remove();
    exportFontStyle.remove();
  }

  onProgress?.({
    phase: "compose",
    current: 2,
    total: 3,
    message: "正在生成 PDF…",
  });

  const { default: JsPDF } = (await import("jspdf")) as { default: JsPdfCtor };
  const pdf = new JsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeightPdf = pdf.internal.pageSize.getHeight();
  const pageHeightPx = Math.round((canvas.width * pageHeightPdf) / pageWidth);

  if (
    canvas.height > pageHeightPx + PAGE_OVERFLOW_TOLERANCE_PX &&
    canvas.height <= pageHeightPx * (1 + SINGLE_PAGE_FIT_MAX_OVERFLOW)
  ) {
    const pageData = fittedSinglePageData(canvas, pageHeightPx);
    pdf.addImage(pageData, "JPEG", 0, 0, pageWidth, pageHeightPdf, undefined, "FAST");
  } else {
    let offsetY = 0;
    let pageIndex = 0;

    while (offsetY < canvas.height - PAGE_OVERFLOW_TOLERANCE_PX) {
      if (pageIndex > 0) pdf.addPage();
      const pageData = canvasPageData(canvas, offsetY, pageHeightPx);
      pdf.addImage(pageData, "JPEG", 0, 0, pageWidth, pageHeightPdf, undefined, "FAST");
      offsetY += pageHeightPx;
      pageIndex += 1;
    }
  }

  onProgress?.({
    phase: "download",
    current: 3,
    total: 3,
    message: "正在下载…",
  });

  const blob = pdf.output("blob") as Blob;
  triggerDownload(blob, outName);
}
