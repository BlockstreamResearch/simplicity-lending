import { Link } from 'react-router-dom'

import ChevronLeftIcon from '@/components/icons/ChevronLeftIcon'
import { RoutePath } from '@/constants/routes'

interface BackLinkProps {
  to?: string
  label?: string
}

export default function BackLink({
  to = RoutePath.Dashboard,
  label = 'Back to Dashboard',
}: BackLinkProps) {
  return (
    <Link
      to={to}
      className='text-foreground inline-flex w-fit items-center gap-2 text-base font-medium'
    >
      <ChevronLeftIcon className='size-4' />
      {label}
    </Link>
  )
}
