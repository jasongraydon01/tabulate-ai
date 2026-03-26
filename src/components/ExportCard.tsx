'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { cn } from '@/lib/utils';

export interface ExportAction {
  key: string;
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: 'default' | 'outline';
  disabled?: boolean;
  loading?: boolean;
}

interface ExportCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  statusLabel: string;
  statusTone: 'success' | 'warning' | 'muted' | 'info';
  blockedCount?: number;
  actions: ExportAction[];
  children?: React.ReactNode;
}

const toneClasses: Record<ExportCardProps['statusTone'], string> = {
  success: 'bg-tab-teal/10 text-tab-teal',
  warning: 'bg-tab-amber/10 text-tab-amber',
  muted: 'bg-muted text-muted-foreground',
  info: 'bg-tab-blue/10 text-tab-blue',
};

export function ExportCard({
  title,
  description,
  icon: Icon,
  statusLabel,
  statusTone,
  blockedCount,
  actions,
  children,
}: ExportCardProps) {
  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-lg font-serif font-light">
          <Icon className="h-5 w-5 text-primary" />
          <span>{title}</span>
          <InfoTooltip text={description} />
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className={cn('text-xs', toneClasses[statusTone])}>
            {statusLabel}
          </Badge>
          {(blockedCount ?? 0) > 0 && (
            <Badge variant="outline" className="text-xs text-tab-rose">
              {blockedCount} blocked
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => {
              const variant = action.variant ?? 'default';
              const disabled = action.disabled || action.loading;
              const label = action.loading ? `${action.label}...` : action.label;

              if (action.href) {
                return (
                  <a key={action.key} href={action.href} download>
                    <Button variant={variant} size="sm" disabled={disabled}>
                      {label}
                    </Button>
                  </a>
                );
              }

              return (
                <Button
                  key={action.key}
                  variant={variant}
                  size="sm"
                  onClick={action.onClick}
                  disabled={disabled}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}
