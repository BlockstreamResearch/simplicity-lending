import { Chip, type ChipProps } from '@heroui/react'

import { getLoanRiskLevel, type LoanRiskLevel } from '@/utils/offers'

const LOAN_RISK_LEVEL_CONFIG: Record<LoanRiskLevel, { label: string; color: ChipProps['color'] }> =
  {
    low: { label: 'Low', color: 'success' },
    medium: { label: 'Medium', color: 'warning' },
    high: { label: 'High', color: 'danger' },
    veryHigh: { label: 'Very High', color: 'danger' },
    critical: { label: 'Critical', color: 'danger' },
  }

interface LoanRiskChipProps {
  ltv: number
}

export default function LoanRiskChip({ ltv }: LoanRiskChipProps) {
  const { label, color } = LOAN_RISK_LEVEL_CONFIG[getLoanRiskLevel(ltv)]
  return (
    <Chip variant='soft' size='lg' color={color}>
      {label}
    </Chip>
  )
}
