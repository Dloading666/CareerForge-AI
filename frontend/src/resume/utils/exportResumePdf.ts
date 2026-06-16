// Defer heavy PDF deps (html2canvas ~150KB + jspdf ~200KB) until user clicks Export.
type Html2CanvasFn = (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
type JsPdfCtor = new (opts?: Record<string, unknown>) => {
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
  addImage: (...args: unknown[]) => void;
  addPage: () => void;
  output: (type?: "blob" | "datauristring" | "dataurlstring" | "save") => Blob | string;
};

const A4_WIDTH_MM = 210;
const DEFAULT_FILENAME = "简历";
const MIN_SCALE = 2;

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

  await waitForFonts(document);
  await waitForImages(element);
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

  onProgress?.({
    phase: "render",
    current: 1,
    total: 2,
    message: "正在拍照预览区…",
  });

  const { default: html2canvas } = (await import("html2canvas")) as { default: Html2CanvasFn };
  const canvas = await html2canvas(element, {
    scale,
    backgroundColor: "#ffffff",
    useCORS: true,
    allowTaint: true,
    logging: false,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  });

  onProgress?.({
    phase: "compose",
    current: 2,
    total: 3,
    message: "正在生成 PDF…",
  });

  const imgWidth = A4_WIDTH_MM;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  const { default: JsPDF } = (await import("jspdf")) as { default: JsPdfCtor };
  const pdf = new JsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeightPdf = pdf.internal.pageSize.getHeight();
  let heightLeft = imgHeight;
  let position = 0;
  const imgData = canvas.toDataURL("image/jpeg", 0.95);

  pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight, undefined, "FAST");
  heightLeft -= pageHeightPdf;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight, undefined, "FAST");
    heightLeft -= pageHeightPdf;
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
