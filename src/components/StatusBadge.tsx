import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Clock } from 'lucide-react'

export type StatusValue = 'pending' | 'validated'

interface StatusBadgeProps {
  status: StatusValue
  variant?: 'solid' | 'outline'
  className?: string
}

export function StatusBadge({ status, variant = 'solid', className }: StatusBadgeProps) {
  const isPending = status === 'pending'
  const Icon = isPending ? Clock : CheckCircle

  if (variant === 'outline') {
    return (
      <Badge
        variant="outline"
        className={`h-5 px-2 py-0 text-xs ${
          isPending ? 'border-amber-500 text-amber-700 dark:text-amber-400' : 'border-green-500 text-green-700 dark:text-green-400'
        } ${className ?? ''}`}
      >
        <Icon className="w-3 h-3 mr-1" />
        {status}
      </Badge>
    )
  }

  return (
    <Badge
      variant={isPending ? 'secondary' : 'default'}
      className={`h-5 px-2 py-0 text-xs ${className ?? ''}`}
    >
      <Icon className="w-3 h-3 mr-1" />
      {status}
    </Badge>
  )
}


