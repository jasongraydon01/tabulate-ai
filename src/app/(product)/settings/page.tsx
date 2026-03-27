'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import posthog from 'posthog-js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Loader2, Building2, User, Users, Trash2, Bell } from 'lucide-react';
import { toast } from 'sonner';
import { AppBreadcrumbs } from '@/components/app-breadcrumbs';
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { WinCrossProfiles } from '@/components/settings/WinCrossProfiles';
import { BillingSection } from '@/components/settings/BillingSection';
import { useAuthContext } from '@/providers/auth-provider';
import { canPerform } from '@/lib/permissions';
import { useSoundPreference } from '@/hooks/useSoundPreference';
import { buildContactPath } from '@/lib/contact';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';

function roleBadgeVariant(role: string) {
  switch (role) {
    case 'admin':
      return 'default' as const;
    case 'external_partner':
      return 'outline' as const;
    default:
      return 'secondary' as const;
  }
}

function roleLabel(role: string) {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'external_partner':
      return 'Partner';
    default:
      return 'Member';
  }
}

export default function SettingsPage() {
  const { convexOrgId, convexUserId, name, email, role } = useAuthContext();
  const canViewSettings = canPerform(role, 'view_settings');
  const canRemoveMember = canPerform(role, 'remove_member');
  const canManageWinCrossProfiles = canPerform(role, 'manage_wincross_profiles');
  const [removingMember, setRemovingMember] = useState<{
    id: string;
    email: string;
    name: string;
  } | null>(null);
  const [pipelineEmails, setPipelineEmails] = useState(true);
  const [notifLoading, setNotifLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useSoundPreference();

  useEffect(() => {
    fetch('/api/notifications/preferences')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.pipelineEmails === 'boolean') {
          setPipelineEmails(data.pipelineEmails);
        }
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setNotifLoading(false));
  }, []);

  const handleTogglePipelineEmails = useCallback(async (checked: boolean) => {
    setPipelineEmails(checked);
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineEmails: checked }),
      });
      if (!res.ok) {
        setPipelineEmails(!checked);
        toast.error('Failed to update notification preferences');
      }
    } catch {
      setPipelineEmails(!checked);
      toast.error('Failed to update notification preferences');
    }
  }, []);

  const org = useQuery(
    api.organizations.get,
    convexOrgId ? { orgId: convexOrgId as Id<"organizations"> } : 'skip',
  );

  const members = useQuery(
    api.orgMemberships.listByOrg,
    convexOrgId ? { orgId: convexOrgId as Id<"organizations"> } : 'skip',
  );

  const isLoading = org === undefined;

  const handleRemoveMember = async () => {
    if (!removingMember) return;
    const res = await fetch(`/api/members/${encodeURIComponent(removingMember.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error('Failed to remove member', {
        description: data?.error || 'Unknown error',
      });
      throw new Error(data?.error || 'Failed to remove member');
    }
    posthog.capture('member_removed', {
      removed_member_id: removingMember.id,
    });
    toast.success(`${removingMember.name} has been removed`);
    setRemovingMember(null);
  };

  return (
    <div>
      <AppBreadcrumbs segments={[{ label: 'Settings' }]} />

      <div className="mt-6 max-w-2xl">
        <h1 className="font-serif text-3xl font-light tracking-tight mb-6">Settings</h1>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !canViewSettings ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">
                You don&apos;t have permission to view settings. Contact your organization admin for access.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Organization */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  Organization
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Name</dt>
                    <dd className="font-medium mt-0.5">{org?.name || 'Unknown'}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            {/* Your Profile */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="h-5 w-5 text-muted-foreground" />
                  Your Profile
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Name</dt>
                    <dd className="font-medium mt-0.5">{name || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="font-medium mt-0.5">{email || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Role</dt>
                    <dd className="mt-0.5">
                      <Badge variant={roleBadgeVariant(role ?? 'member')}>
                        {roleLabel(role ?? 'member')}
                      </Badge>
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            {/* Notifications */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                  Notifications
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Pipeline email notifications</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Get emailed when a pipeline completes or fails
                    </p>
                  </div>
                  <Switch
                    checked={pipelineEmails}
                    onCheckedChange={handleTogglePipelineEmails}
                    disabled={notifLoading}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Sound notifications</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Play a sound when a pipeline starts, needs review, or finishes
                    </p>
                  </div>
                  <Switch
                    checked={soundEnabled}
                    onCheckedChange={setSoundEnabled}
                  />
                </div>
              </CardContent>
            </Card>

            <BillingSection role={role} />

            {canManageWinCrossProfiles && convexOrgId && (
              <WinCrossProfiles orgId={convexOrgId as Id<'organizations'>} />
            )}

            {!canManageWinCrossProfiles && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">WinCross Profiles</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    WinCross profile uploads are managed by your workspace administrator.
                    Ask them to upload or update the org default profile when a client-specific
                    export style is needed.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    If your team needs help preparing a profile,{' '}
                    <Link
                      href={buildContactPath({ topic: 'wincross' })}
                      className="text-foreground underline underline-offset-4"
                    >
                      contact TabulateAI
                    </Link>
                    .
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Need Help?</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Questions about workspace setup, billing, exports, or anything else?
                  {' '}
                  <Link
                    href={buildContactPath()}
                    className="text-foreground underline underline-offset-4"
                  >
                    Contact TabulateAI
                  </Link>
                  .
                </p>
              </CardContent>
            </Card>

            {/* Members */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  Members
                </CardTitle>
              </CardHeader>
              <CardContent>
                {members === undefined ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No members found.</p>
                ) : (
                  <div className="divide-y">
                    {members.map((member) => {
                      const isYou = String(member.userId) === convexUserId;
                      return (
                        <div
                          key={String(member._id)}
                          className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {member.name}
                              {isYou && (
                                <span className="text-muted-foreground font-normal ml-1">(you)</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                          </div>
                          <div className="flex items-center gap-2 ml-2 shrink-0">
                            <Badge variant={roleBadgeVariant(member.role)}>
                              {roleLabel(member.role)}
                            </Badge>
                            {canRemoveMember && !isYou && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-red-500"
                                onClick={() =>
                                  setRemovingMember({
                                    id: String(member._id),
                                    email: member.email,
                                    name: member.name,
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                                <span className="sr-only">Remove {member.name}</span>
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <ConfirmDestructiveDialog
          open={removingMember !== null}
          onOpenChange={(open) => {
            if (!open) setRemovingMember(null);
          }}
          title="Remove member"
          description={`This will remove ${removingMember?.name ?? 'this member'} from the organization. They will lose access immediately.`}
          confirmText={removingMember?.email ?? ''}
          confirmLabel="Type their email address to confirm"
          destructiveLabel="Remove Member"
          onConfirm={handleRemoveMember}
        />
      </div>
    </div>
  );
}
