'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

interface ConfirmDestructiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** The exact text the user must type to confirm. */
  confirmText: string;
  /** Label shown above the input, e.g. "Type the project name to confirm" */
  confirmLabel: string;
  /** Label for the destructive button, e.g. "Delete Project" */
  destructiveLabel: string;
  onConfirm: () => Promise<void>;
}

export function ConfirmDestructiveDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  confirmLabel,
  destructiveLabel,
  onConfirm,
}: ConfirmDestructiveDialogProps) {
  const [inputValue, setInputValue] = useState('');
  const [isPending, setIsPending] = useState(false);

  const isMatch = inputValue === confirmText;

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setInputValue('');
      setIsPending(false);
    }
  }, [open]);

  const handleConfirm = useCallback(async () => {
    if (!isMatch || isPending) return;
    setIsPending(true);
    try {
      await onConfirm();
    } finally {
      setIsPending(false);
    }
  }, [isMatch, isPending, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && isMatch && !isPending) {
        e.preventDefault();
        handleConfirm();
      }
    },
    [isMatch, isPending, handleConfirm]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Prevent closing while a delete is in progress
        if (isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!isPending}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="confirm-input" className="text-sm">
            {confirmLabel}
          </Label>
          <Input
            id="confirm-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={confirmText}
            disabled={isPending}
            autoComplete="off"
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isMatch || isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {destructiveLabel}...
              </>
            ) : (
              destructiveLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
