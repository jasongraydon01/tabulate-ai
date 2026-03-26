/**
 * @deprecated Legacy Review Tables UI removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not import from active code.
 */
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sparkles } from 'lucide-react';

export interface RegenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableId: string;
  questionText: string;
  relatedTableCount: number;
  onSubmit: (feedback: string, includeRelated: boolean) => void;
}

export function RegenerateDialog({
  open,
  onOpenChange,
  tableId,
  questionText,
  relatedTableCount,
  onSubmit,
}: RegenerateDialogProps) {
  const [feedback, setFeedback] = useState('');
  const [includeRelated, setIncludeRelated] = useState(false);

  const handleSubmit = () => {
    if (!feedback.trim()) return;
    onSubmit(feedback.trim(), includeRelated);
    setFeedback('');
    setIncludeRelated(false);
    onOpenChange(false);
  };

  const charCount = feedback.length;
  const maxChars = 2000;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-tab-indigo" />
            Regenerate Table
          </DialogTitle>
          <DialogDescription>
            Provide feedback to guide the AI in improving this table.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Table context */}
          <div className="text-sm">
            <p className="text-muted-foreground mb-1">Table:</p>
            <p className="font-mono text-xs bg-muted px-2 py-1 rounded">
              {tableId}
            </p>
            {questionText && (
              <p className="text-sm mt-1 text-muted-foreground truncate">
                {questionText}
              </p>
            )}
          </div>

          {/* Feedback textarea */}
          <div className="space-y-2">
            <Label htmlFor="feedback">Feedback</Label>
            <Textarea
              id="feedback"
              placeholder="e.g., Add a NET row for 'Top 2 Box' combining responses 4 and 5. Fix the label for row 3 to match the survey wording..."
              value={feedback}
              onChange={(e) =>
                setFeedback(e.target.value.slice(0, maxChars))
              }
              rows={5}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground text-right">
              {charCount}/{maxChars}
            </p>
          </div>

          {/* Include related tables */}
          {relatedTableCount > 0 && (
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="includeRelated"
                checked={includeRelated}
                onChange={(e) => setIncludeRelated(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-tab-indigo"
              />
              <Label htmlFor="includeRelated" className="text-sm font-normal">
                Include {relatedTableCount} related{' '}
                {relatedTableCount === 1 ? 'table' : 'tables'}
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!feedback.trim()}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            Add to Queue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
