import * as React from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-start md:justify-between mb-8 gap-4">
      <div className="flex-1">
        <h1 className="font-serif text-3xl font-light tracking-tight">{title}</h1>
        {description ? (
          <p className="text-muted-foreground mt-2 max-w-2xl">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex-shrink-0">{actions}</div> : null}
    </div>
  )
}


