'use client';

import { THEMES, type ThemePalette } from '@/lib/excel/themes';
import { cn } from '@/lib/utils';

interface ThemePickerProps {
  value: string;
  onChange: (theme: string) => void;
}

/**
 * Visual theme picker showing each theme's 6 group colors as horizontal bars.
 */
export function ThemePicker({ value, onChange }: ThemePickerProps) {
  const themes = Object.values(THEMES);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Color theme">
      {themes.map((theme) => (
        <ThemeCard
          key={theme.name}
          theme={theme}
          isActive={value === theme.name}
          onClick={() => onChange(theme.name)}
        />
      ))}
    </div>
  );
}

function ThemeCard({
  theme,
  isActive,
  onClick,
}: {
  theme: ThemePalette;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      aria-label={theme.displayName}
      onClick={onClick}
      className={cn(
        'rounded-lg border p-3 text-left transition-all hover:border-foreground/20',
        isActive && 'ring-2 ring-primary border-primary'
      )}
    >
      <div className="space-y-1.5">
        {theme.groups.map((group, i) => (
          <div
            key={i}
            className="h-2 rounded-full"
            style={{ backgroundColor: argbToHex(group.a) }}
          />
        ))}
      </div>
      <p className="text-xs font-medium mt-2">{theme.displayName}</p>
    </button>
  );
}

/** Convert ARGB string (e.g. "FFDCE6F1") to CSS hex (#DCE6F1). */
function argbToHex(argb: string): string {
  return `#${argb.slice(2)}`;
}
