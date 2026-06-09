export function printResumeElement(element: HTMLElement) {
  const printFrame = document.createElement('iframe')
  printFrame.style.position = 'fixed'
  printFrame.style.right = '0'
  printFrame.style.bottom = '0'
  printFrame.style.width = '1px'
  printFrame.style.height = '1px'
  printFrame.style.border = '0'
  printFrame.style.opacity = '0'
  document.body.appendChild(printFrame)

  const win = printFrame.contentWindow
  if (!win) {
    document.body.removeChild(printFrame)
    return
  }

  const clone = element.cloneNode(true) as HTMLElement
  clone.style.transform = 'none'
  clone.style.width = '210mm'
  clone.style.minHeight = '297mm'
  clone.style.boxShadow = 'none'

  win.document.open()
  win.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Resume Export</title>
        <style>
          @page { size: A4; margin: 0; }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; background: #fff; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        </style>
      </head>
      <body></body>
    </html>
  `)
  win.document.body.appendChild(clone)
  win.document.close()

  window.setTimeout(() => {
    win.focus()
    win.print()
    window.setTimeout(() => document.body.removeChild(printFrame), 1000)
  }, 200)
}
