// Hook de responsividade: lê o tamanho do terminal e re-renderiza no resize.
// Componentes dentro do <Static> capturam o tamanho do momento da impressão.
import { useEffect, useState } from 'react'

export type TermSize = { cols: number; rows: number }

const read = (): TermSize => ({
  cols: process.stdout.columns ?? 80,
  rows: process.stdout.rows ?? 24,
})

export const useTermSize = (): TermSize => {
  const [size, setSize] = useState<TermSize>(read)
  useEffect(() => {
    const onResize = (): void => setSize(read())
    process.stdout.on('resize', onResize)
    return () => {
      process.stdout.off('resize', onResize)
    }
  }, [])
  return size
}
