'use client';

import { useState, useRef, useCallback } from 'react';
import { useFormContext, useFieldArray } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { WizardFormValues } from '@/schemas/wizardSchema';

// ─── Validation ─────────────────────────────────────────────────────────────

export interface MessageValidation {
  isValid: boolean;
  errors: string[];
  messageCount: number;
  alternateCount: number;
}

export function validateMessages(
  messages: Array<{ code: string; text: string; variantOf?: string }>,
): MessageValidation {
  const errors: string[] = [];
  const nonEmpty = messages.filter(m => m.code.trim() || m.text.trim());

  if (nonEmpty.length < 2) {
    errors.push('At least 2 messages are required');
  }

  // Check for duplicate codes
  const codes = nonEmpty.map(m => m.code.trim().toUpperCase());
  const duplicates = codes.filter((c, i) => c && codes.indexOf(c) !== i);
  if (duplicates.length > 0) {
    errors.push(`Duplicate codes: ${[...new Set(duplicates)].join(', ')}`);
  }

  // Check for empty codes/text
  const emptyFields = nonEmpty.filter(m => !m.code.trim() || !m.text.trim());
  if (emptyFields.length > 0) {
    errors.push(`${emptyFields.length} message(s) have empty code or text`);
  }

  // Check variant references
  const codeSet = new Set(codes);
  const alternateCount = nonEmpty.filter(m => m.variantOf?.trim()).length;
  for (const msg of nonEmpty) {
    if (msg.variantOf?.trim()) {
      const ref = msg.variantOf.trim().toUpperCase();
      if (!codeSet.has(ref)) {
        errors.push(`"${msg.code}" references unknown code "${msg.variantOf}"`);
      }
      if (ref === msg.code.trim().toUpperCase()) {
        errors.push(`"${msg.code}" cannot be a variant of itself`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    messageCount: nonEmpty.length,
    alternateCount,
  };
}

// ─── File Parser (client-side) ──────────────────────────────────────────────

async function parseMessageFile(
  file: File,
): Promise<Array<{ code: string; text: string; variantOf?: string }>> {
  // Dynamic import ExcelJS only when needed (heavy dependency)
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();

  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'csv') {
    const text = await file.text();
    const worksheet = workbook.addWorksheet('Sheet1');
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) {
        const cells = parseCSVLine(line);
        worksheet.addRow(cells);
      }
    }
  } else {
    try {
      const buffer = await file.arrayBuffer();
      await workbook.xlsx.load(buffer);
    } catch (loadError) {
      if (ext === 'xls') {
        throw new Error(
          'Legacy .xls format is not supported. Please re-save the file as .xlsx in Excel and try again.'
        );
      }
      throw loadError;
    }
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) return [];

  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const cells = row.values as unknown[];
    rows.push(cells.slice(1).map(c => {
      if (c == null) return '';
      if (typeof c !== 'object') return String(c);
      const obj = c as Record<string, unknown>;
      if ('richText' in obj && Array.isArray(obj.richText)) {
        return (obj.richText as Array<{ text: string }>).map(rt => rt.text).join('');
      }
      if ('text' in obj && typeof obj.text === 'string') return obj.text;
      if ('formula' in obj || 'sharedFormula' in obj) {
        const result = obj.result;
        if (result == null) return '';
        if (typeof result === 'object') return '';
        return String(result);
      }
      return '';
    }));
  });

  if (rows.length === 0) return [];

  // Detect columns
  const headers = rows[0].map(h => h.toLowerCase().trim());
  let codeCol = findCol(headers, ['code', 'message_id', 'id', 'msg_id', 'message_code']);
  let textCol = findCol(headers, ['message', 'text', 'description', 'message_text', 'full_text', 'content']);
  const altCol = findCol(headers, ['is_alternate', 'is_alt', 'alternate']);
  const altOfCol = findCol(headers, ['alternate_of', 'alt_of', 'variant_of']);

  let dataStart = 1;
  if (codeCol === -1 && textCol === -1) {
    codeCol = 0;
    textCol = rows[0].length > 1 ? 1 : -1;
    dataStart = 0;
  } else {
    if (codeCol === -1) codeCol = 0;
    if (textCol === -1) textCol = codeCol === 0 ? 1 : 0;
  }

  const result: Array<{ code: string; text: string; variantOf?: string }> = [];

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    const code = (row[codeCol] ?? '').trim();
    const text = textCol >= 0 ? (row[textCol] ?? '').trim() : '';
    if (!code && !text) continue;

    let variantOf: string | undefined;
    if (altOfCol >= 0) {
      const altOfVal = (row[altOfCol] ?? '').trim();
      if (altOfVal) variantOf = altOfVal;
    } else if (altCol >= 0) {
      const isAlt = (row[altCol] ?? '').trim().toLowerCase();
      if (isAlt === 'yes' || isAlt === 'true' || isAlt === '1') {
        // If is_alternate but no alternate_of column, leave variantOf empty — user can set it in the grid
      }
    }

    result.push({ code, text, variantOf });
  }

  return result;
}

function findCol(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.indexOf(c);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ─── Component ──────────────────────────────────────────────────────────────

const NONE_VALUE = '__none__';

export function StepMaxDiffMessages() {
  const form = useFormContext<WizardFormValues>();
  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: 'maxdiffMessages',
  });

  const [isDragOver, setIsDragOver] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messages = form.watch('maxdiffMessages') ?? [];
  const validation = validateMessages(messages);

  // Get primary codes for the variant-of dropdown
  const primaryCodes = messages
    .filter(m => m.code.trim() && !m.variantOf?.trim())
    .map(m => m.code.trim());

  // ── File handling ───────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
    if (!validExtensions.includes(ext)) {
      toast.error('Invalid file format', {
        description: 'Please upload an Excel (.xlsx, .xls) or CSV file.',
      });
      return;
    }

    setIsParsing(true);
    try {
      const parsed = await parseMessageFile(file);
      if (parsed.length === 0) {
        toast.error('No messages found', {
          description: 'The file appears to be empty or has an unrecognized format.',
        });
        return;
      }

      // Check for messages where text couldn't be parsed (e.g., formula cells, merged cells)
      const emptyTextCount = parsed.filter(m => m.code.trim() && !m.text.trim()).length;

      replace(parsed);

      if (emptyTextCount > 0) {
        toast.warning(`Imported ${parsed.length} messages — ${emptyTextCount} with missing text`, {
          description: 'Some message cells could not be read (formulas, merged cells, etc.). Please paste the message text directly into the empty cells below.',
          duration: 8000,
        });
      } else if (messages.length > 0) {
        toast.success(`Imported ${parsed.length} messages`, {
          description: 'Previous entries were replaced.',
        });
      } else {
        toast.success(`Imported ${parsed.length} messages`);
      }
    } catch (error) {
      console.error('Failed to parse message file:', error);
      toast.error('Failed to parse file', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsParsing(false);
    }
  }, [messages.length, replace]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [handleFile]);

  // ── Row operations ────────────────────────────────────────────────────────

  const addRow = () => {
    append({ code: '', text: '', variantOf: '' });
  };

  const clearAll = () => {
    if (messages.length === 0) return;
    replace([]);
    toast.info('All messages cleared');
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Messages</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Provide the full text for each message. These replace the truncated labels
            from the .sav file and appear in the final crosstab output.
          </p>
          <p>
            Each message needs a <span className="font-mono text-foreground">code</span> (matching
            the identifier in the .sav) and the complete{' '}
            <span className="font-mono text-foreground">message text</span>. Alternate variants
            (e.g., rephrased versions of the same claim) are optional.
          </p>
        </CardContent>
      </Card>

      {/* Import section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* File upload */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <FileSpreadsheet className="h-4 w-4" />
              Import from file
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className={cn(
                'flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition-colors cursor-pointer',
                isDragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/50',
              )}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-6 w-6 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground text-center">
                {isParsing ? 'Parsing...' : 'Drop file here or click to browse'}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">.xlsx, .csv (legacy .xls must be re-saved as .xlsx)</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
            <a
              href="/api/maxdiff/template"
              download
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <Download className="h-3 w-3" />
              Download template
            </a>
          </CardContent>
        </Card>

        {/* Manual entry */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Plus className="h-4 w-4" />
              Manual entry
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Or enter messages directly in the grid below. Click &ldquo;Add Message&rdquo; to add
              a new row, or import a file to pre-populate the grid.
            </p>
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Message
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Message grid */}
      {fields.length > 0 && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Messages</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={addRow}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="text-muted-foreground hover:text-tab-rose"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Clear All
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Code</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="w-[140px]">Variant of</TableHead>
                    <TableHead className="w-[40px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.map((field, index) => (
                    <TableRow key={field.id}>
                      <TableCell className="p-1">
                        <Input
                          {...form.register(`maxdiffMessages.${index}.code`)}
                          placeholder="I1"
                          className="font-mono text-xs h-8"
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <Input
                          {...form.register(`maxdiffMessages.${index}.text`)}
                          placeholder={
                            messages[index]?.code?.trim() && !messages[index]?.text?.trim()
                              ? 'Paste message text here — could not read from file'
                              : 'Full message text...'
                          }
                          className={cn(
                            'text-xs h-8',
                            messages[index]?.code?.trim() && !messages[index]?.text?.trim()
                              && 'border-tab-amber/50 placeholder:text-tab-amber/70',
                          )}
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <Select
                          value={messages[index]?.variantOf?.trim() || NONE_VALUE}
                          onValueChange={(val) => {
                            form.setValue(
                              `maxdiffMessages.${index}.variantOf`,
                              val === NONE_VALUE ? '' : val,
                            );
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Primary" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE_VALUE}>
                              <span className="text-muted-foreground">Primary</span>
                            </SelectItem>
                            {primaryCodes
                              .filter(c => c.toUpperCase() !== messages[index]?.code?.trim().toUpperCase())
                              .map(code => (
                                <SelectItem key={code} value={code}>
                                  {code}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="p-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-tab-rose"
                          onClick={() => remove(index)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Validation feedback */}
      {messages.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          {validation.isValid ? (
            <div className="flex items-center gap-1.5 text-tab-teal">
              <CheckCircle2 className="h-4 w-4" />
              <span>
                {validation.messageCount} messages
                {validation.alternateCount > 0 && ` (${validation.alternateCount} alternate${validation.alternateCount > 1 ? 's' : ''})`}
              </span>
            </div>
          ) : (
            <div className="space-y-1">
              {validation.errors.map((err, i) => (
                <div key={i} className="flex items-center gap-1.5 text-tab-amber">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{err}</span>
                </div>
              ))}
            </div>
          )}
          {validation.messageCount > 0 && (
            <Badge variant="outline" className="font-mono text-xs ml-auto">
              {validation.messageCount} total
            </Badge>
          )}
        </div>
      )}

      {fields.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <p>No messages added yet. Import a file or add messages manually.</p>
          <p className="text-xs mt-1 text-muted-foreground/60">
            You can skip this step — the pipeline will use labels from the .sav file.
          </p>
        </div>
      )}
    </div>
  );
}
