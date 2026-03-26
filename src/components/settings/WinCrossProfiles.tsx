'use client';

import React, { useMemo, useState } from 'react';
import { Buffer } from 'buffer';
import { useQuery } from 'convex/react';
import { Loader2, Settings2, Star, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { parseWinCrossPreferenceJob } from '@/lib/exportData/wincross/parser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

interface WinCrossProfilesProps {
  orgId: Id<'organizations'>;
}

interface PreviewState {
  sectionNames: string[];
  encoding: string;
  warnings: string[];
  version: string | null;
  tableCount: number;
  useCount: number;
  afCount: number;
  sbaseCount: number;
}

export function WinCrossProfiles({ orgId }: WinCrossProfilesProps) {
  const profiles = useQuery(api.wincrossPreferenceProfiles.listByOrg, { orgId });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState<{ id: string; name: string } | null>(null);
  const [updatingDefaultId, setUpdatingDefaultId] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && selectedFile !== null && !isUploading;
  const profileCountLabel = useMemo(() => {
    if (profiles === undefined) return 'Loading profiles';
    return `${profiles.length}/10 profiles saved`;
  }, [profiles]);

  async function handleFileChange(file: File | null) {
    setSelectedFile(file);
    setPreview(null);
    setPreviewError(null);

    if (!file) return;

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = parseWinCrossPreferenceJob(buffer);
      setPreview({
        sectionNames: parsed.diagnostics.sectionNames,
        encoding: parsed.diagnostics.encoding,
        warnings: parsed.diagnostics.warnings,
        version: parsed.profile.version,
        tableCount: parsed.profile.tablePatternHints.tableCount,
        useCount: parsed.profile.tablePatternHints.useCount,
        afCount: parsed.profile.tablePatternHints.afCount,
        sbaseCount: parsed.profile.tablePatternHints.sbaseCount,
      });

      if (!name.trim()) {
        setName(file.name.replace(/\.job$/i, ''));
      }
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Could not parse the selected .job file.');
    }
  }

  async function handleUpload() {
    if (!selectedFile || !name.trim()) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.set('name', name.trim());
      formData.set('description', description.trim());
      formData.set('isDefault', String(isDefault));
      formData.set('file', selectedFile);

      const response = await fetch('/api/orgs/wincross-profiles', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to save WinCross profile');
      }

      toast.success('WinCross profile saved');
      setName('');
      setDescription('');
      setIsDefault(false);
      setSelectedFile(null);
      setPreview(null);
      setPreviewError(null);
    } catch (error) {
      toast.error('Failed to save WinCross profile', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSetDefault(profileId: string) {
    setUpdatingDefaultId(profileId);
    try {
      const response = await fetch(`/api/orgs/wincross-profiles/${encodeURIComponent(profileId)}/default`, {
        method: 'PATCH',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to set default profile');
      }
      toast.success('Default WinCross profile updated');
    } catch (error) {
      toast.error('Failed to set default profile', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setUpdatingDefaultId(null);
    }
  }

  async function handleDeleteProfile() {
    if (!deletingProfile) return;

    try {
      const response = await fetch(`/api/orgs/wincross-profiles/${encodeURIComponent(deletingProfile.id)}`, {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to delete WinCross profile');
      }
      toast.success('WinCross profile deleted');
      setDeletingProfile(null);
    } catch (error) {
      toast.error('Failed to delete WinCross profile', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings2 className="h-5 w-5 text-muted-foreground" />
                WinCross Profiles
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Save up to 10 org-level `.job` preference profiles and choose which one should be the default for new WinCross exports.
              </p>
            </div>
            <Badge variant="outline">{profileCountLabel}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-2">
                <Label htmlFor="wincross-profile-name">Profile name</Label>
                <Input
                  id="wincross-profile-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Client standard"
                  disabled={isUploading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wincross-profile-description">Description</Label>
                <Textarea
                  id="wincross-profile-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional notes about when this profile should be used."
                  disabled={isUploading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wincross-profile-file">WinCross .job file</Label>
                <Input
                  id="wincross-profile-file"
                  type="file"
                  accept=".job,text/plain"
                  disabled={isUploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    void handleFileChange(file);
                  }}
                />
              </div>
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <Switch
                  checked={isDefault}
                  onCheckedChange={setIsDefault}
                  disabled={isUploading}
                />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Set as org default</p>
                  <p className="text-xs text-muted-foreground">
                    This profile will be preselected in the wizard and WinCross export UI.
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleUpload} disabled={!canSubmit}>
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Save Profile
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <p className="mb-3 text-sm font-medium">Preview</p>
              {previewError ? (
                <p className="text-sm text-destructive">{previewError}</p>
              ) : preview ? (
                <div className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-muted-foreground">Version</p>
                      <p className="font-medium">{preview.version ?? 'Unknown'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Encoding</p>
                      <p className="font-medium">{preview.encoding}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-muted-foreground">Tables in source</p>
                      <p className="font-medium">{preview.tableCount}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">USE / AF / SBase</p>
                      <p className="font-medium">
                        {preview.useCount} / {preview.afCount} / {preview.sbaseCount}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Parsed sections</p>
                    <p className="font-medium">{preview.sectionNames.join(', ') || 'None detected'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Warnings</p>
                    <p className="font-medium">
                      {preview.warnings.length > 0 ? preview.warnings.join('; ') : 'None'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a `.job` file to preview the extracted version, section list, and table-pattern hints before saving.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Saved profiles</p>
            {profiles === undefined ? (
              <div className="flex items-center justify-center rounded-lg border p-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : profiles.length === 0 ? (
              <div className="rounded-lg border p-6 text-sm text-muted-foreground">
                No WinCross profiles saved yet.
              </div>
            ) : (
              <div className="space-y-3">
                {profiles.map((profile) => (
                  <div key={String(profile._id)} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{profile.name}</p>
                          {profile.isDefault && (
                            <Badge variant="secondary" className="bg-primary/10 text-primary">
                              <Star className="mr-1 h-3 w-3" />
                              Default
                            </Badge>
                          )}
                        </div>
                        {profile.description && (
                          <p className="text-sm text-muted-foreground">{profile.description}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {profile.sourceFileName ?? 'No source filename'} · Version {profile.profileSummary.version ?? 'unknown'} · {profile.profileSummary.tablePatternHints.tableCount} tables
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!profile.isDefault && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleSetDefault(String(profile._id))}
                            disabled={updatingDefaultId === String(profile._id)}
                          >
                            {updatingDefaultId === String(profile._id) ? 'Updating...' : 'Set Default'}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeletingProfile({ id: String(profile._id), name: profile.name })}
                        >
                          <Trash2 className="mr-1 h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmDestructiveDialog
        open={deletingProfile !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingProfile(null);
        }}
        title="Delete WinCross profile"
        description={`This will permanently remove "${deletingProfile?.name ?? ''}" from the organization.`}
        confirmText={deletingProfile?.name ?? ''}
        confirmLabel="Type the profile name to confirm"
        destructiveLabel="Delete Profile"
        onConfirm={handleDeleteProfile}
      />
    </>
  );
}
