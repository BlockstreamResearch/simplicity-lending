import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const

export function Reveal({
  children,
  delay = 0,
  y = 24,
  x = 0,
  className = '',
}: {
  children: ReactNode
  delay?: number
  y?: number
  x?: number
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y, x }}
      whileInView={{ opacity: 1, y: 0, x: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.6, ease: EASE_OUT_EXPO, delay }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
