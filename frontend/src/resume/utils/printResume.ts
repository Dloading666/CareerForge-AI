const PRINT_FRAME_ID = 'resume-print-frame'

function waitForImages(doc: Document) {
  return Promise.all(
    Array.from(doc.images).map(
      (image) =>
        image.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              image.addEventListener('load', () => resolve(), { once: true })
              image.addEventListener('error', () => resolve(), { once: true })
            }),
    ),
  )
}

export async function printResumeElement(element: HTMLElement) {
  document.getElementById(PRINT_FRAME_ID)?.remove()

  const printFrame = document.createElement('iframe')
  printFrame.id = PRINT_FRAME_ID
  printFrame.style.position = 'fixed'
  printFrame.style.left = '-10000px'
  printFrame.style.top = '0'
  printFrame.style.width = '210mm'
  printFrame.style.height = '297mm'
  printFrame.style.border = '0'
  printFrame.style.opacity = '0'
  printFrame.style.pointerEvents = 'none'
  document.body.appendChild(printFrame)

  const win = printFrame.contentWindow
  if (!win) {
    printFrame.remove()
    return
  }

  const clone = element.cloneNode(true) as HTMLElement
  clone.style.setProperty('display', clone.style.display || 'block')
  clone.style.setProperty('width', '210mm', 'important')
  clone.style.setProperty('min-width', '210mm', 'important')
  clone.style.setProperty('max-width', '210mm', 'important')
  clone.style.setProperty('min-height', '297mm', 'important')
  clone.style.setProperty('margin', '0', 'important')
  clone.style.setProperty('transform', 'none', 'important')
  clone.style.setProperty('zoom', '1', 'important')
  clone.style.setProperty('box-shadow', 'none', 'important')

  win.document.open()
  win.document.write(`
    <!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <base href="${window.location.origin}/">
        <meta charset="UTF-8">
        <title>简历导出</title>
        <style>
          @font-face {
            font-family: 'Alibaba PuHuiTi';
            src: url('/fonts/AlibabaPuHuiTi-3-55-Regular.ttf') format('truetype');
            font-weight: 400;
            font-style: normal;
            font-display: block;
          }
          @font-face {
            font-family: 'Alibaba PuHuiTi';
            src: url('/fonts/AlibabaPuHuiTi-3-85-Bold.ttf') format('truetype');
            font-weight: 700;
            font-style: normal;
            font-display: block;
          }
          @page {
            size: A4 portrait;
            margin: 0;
          }
          *, *::before, *::after {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          html,
          body {
            width: 210mm;
            min-width: 210mm;
            margin: 0;
            padding: 0;
            overflow: visible;
            background: #fff;
          }
          body {
            font-family: 'Alibaba PuHuiTi', 'PingFang SC', 'Microsoft YaHei', sans-serif;
          }
          .resume-document {
            width: 210mm !important;
            min-width: 210mm !important;
            max-width: 210mm !important;
            min-height: 297mm !important;
            margin: 0 !important;
            transform: none !important;
            zoom: 1 !important;
            box-shadow: none !important;
          }
          .resume-document h1,
          .resume-document h2,
          .resume-document h3,
          .resume-document h4,
          .resume-document h5,
          .resume-document h6 {
            font-family: inherit;
          }
          .resume-document ul,
          .resume-document ol {
            margin-block-start: 4px;
            margin-block-end: 0;
          }
          .resume-document li + li {
            margin-top: 1px;
          }
          .resume-document svg {
            display: block !important;
            width: 16px !important;
            height: 16px !important;
            min-width: 16px !important;
            min-height: 16px !important;
            max-width: 16px !important;
            max-height: 16px !important;
            flex: 0 0 16px !important;
          }
          .resume-document img {
            max-width: 100%;
          }
        </style>
      </head>
      <body></body>
    </html>
  `)
  win.document.body.appendChild(clone)
  win.document.close()

  const cleanup = () => {
    if (document.body.contains(printFrame)) printFrame.remove()
  }
  win.addEventListener('afterprint', cleanup, { once: true })

  try {
    await win.document.fonts?.ready
    await waitForImages(win.document)
    await new Promise<void>((resolve) => {
      win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve()))
    })

    win.focus()
    win.print()
    window.setTimeout(cleanup, 60_000)
  } catch (error) {
    cleanup()
    throw error
  }
}
