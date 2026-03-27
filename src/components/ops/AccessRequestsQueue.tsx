'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type AccessRequestSource = 'demo_status' | 'demo_email' | 'pricing' | 'auth_no_org' | 'marketing';
type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

interface AccessRequestRecord {
  _id: string;
  name: string;
  email: string;
  company: string;
  emailDomain: string;
  initialAdminEmail?: string;
  notes?: string;
  source: AccessRequestSource;
  status: AccessRequestStatus;
  createdAt: number;
  reviewedAt?: number;
  reviewedByEmail?: string;
  reviewNotes?: string;
}

const SOURCE_LABELS: Record<AccessRequestSource, string> = {
  demo_status: 'Demo status',
  demo_email: 'Demo email',
  pricing: 'Pricing',
  auth_no_org: 'No org auth',
  marketing: 'Marketing',
};

function statusBadgeVariant(status: AccessRequestStatus): 'default' | 'secondary' | 'destructive' {
  switch (status) {
    case 'approved':
      return 'default';
    case 'rejected':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export function AccessRequestsQueue({ initialRequests }: { initialRequests: AccessRequestRecord[] }) {
  const [requests, setRequests] = useState(initialRequests);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(requestId: string, status: 'approved' | 'rejected') {
    setError(null);
    setPendingRequestId(requestId);

    try {
      const response = await fetch(`/api/ops/access-requests/${encodeURIComponent(requestId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          reviewNotes: reviewNotes[requestId] ?? '',
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error || 'Failed to update access request.');
        return;
      }

      setRequests((current) =>
        current.map((request) =>
          request._id === requestId
            ? {
                ...request,
                status,
                reviewedAt: Date.now(),
                reviewNotes: reviewNotes[requestId] || undefined,
              }
            : request,
        ),
      );
    } catch {
      setError('Failed to update access request.');
    } finally {
      setPendingRequestId(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-md border border-ct-red/20 bg-ct-red-dim px-4 py-3 text-sm text-ct-red">
          {error}
        </div>
      )}

      {requests.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No access requests yet.
        </div>
      ) : (
        requests.map((request) => {
          const isPending = request.status === 'pending';

          return (
            <div key={request._id} className="rounded-lg border border-border bg-card p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="font-serif text-2xl font-light">{request.company}</h2>
                    <Badge variant={statusBadgeVariant(request.status)}>
                      {request.status}
                    </Badge>
                    <Badge variant="outline">
                      {SOURCE_LABELS[request.source]}
                    </Badge>
                  </div>

                  <dl className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-foreground">Requester</dt>
                      <dd>{request.name}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Work Email</dt>
                      <dd>{request.email}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Domain</dt>
                      <dd>{request.emailDomain}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Submitted</dt>
                      <dd>{new Date(request.createdAt).toLocaleString()}</dd>
                    </div>
                    {request.initialAdminEmail && (
                      <div className="sm:col-span-2">
                        <dt className="font-medium text-foreground">Initial Admin</dt>
                        <dd>{request.initialAdminEmail}</dd>
                      </div>
                    )}
                    {request.notes && (
                      <div className="sm:col-span-2">
                        <dt className="font-medium text-foreground">Requester Notes</dt>
                        <dd className="whitespace-pre-wrap">{request.notes}</dd>
                      </div>
                    )}
                    {request.reviewedAt && (
                      <div className="sm:col-span-2">
                        <dt className="font-medium text-foreground">Reviewed</dt>
                        <dd>
                          {new Date(request.reviewedAt).toLocaleString()}
                          {request.reviewedByEmail ? ` by ${request.reviewedByEmail}` : ''}
                        </dd>
                      </div>
                    )}
                    {request.reviewNotes && (
                      <div className="sm:col-span-2">
                        <dt className="font-medium text-foreground">Review Notes</dt>
                        <dd className="whitespace-pre-wrap">{request.reviewNotes}</dd>
                      </div>
                    )}
                  </dl>
                </div>

                <div className="w-full max-w-md space-y-3">
                  {isPending ? (
                    <>
                      <Textarea
                        rows={4}
                        placeholder="Optional review notes"
                        value={reviewNotes[request._id] ?? ''}
                        onChange={(event) =>
                          setReviewNotes((current) => ({
                            ...current,
                            [request._id]: event.target.value,
                          }))
                        }
                      />
                      <div className="flex flex-wrap gap-3">
                        <Button
                          onClick={() => void updateStatus(request._id, 'approved')}
                          disabled={pendingRequestId !== null}
                        >
                          {pendingRequestId === request._id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Approve & Email'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => void updateStatus(request._id, 'rejected')}
                          disabled={pendingRequestId !== null}
                        >
                          Reject
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      This request has already been reviewed.
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
