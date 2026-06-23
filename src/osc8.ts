// Hyperlink OSC 8: o terminal (gnome-terminal, iTerm, kitty…) mostra tooltip no
// hover e deixa clicável. Sequência: ESC ]8;;URL ST  label  ESC ]8;; ST
const ESC = '\x1b'
const ST = '\x1b\\'

export const link = (label: string, url: string): string =>
  `${ESC}]8;;${url}${ST}${label}${ESC}]8;;${ST}`

// caminho de arquivo absoluto → URL file:// pra usar no link()
export const fileUrl = (absPath: string): string => `file://${absPath}`
