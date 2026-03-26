import { notFound } from 'next/navigation';

/**
 * @deprecated Legacy Review Tables route removed from the product surface in Phase 6.
 * Stale bookmarks should fail with 404 rather than implying in-browser table editing still exists.
 */
export default function DeprecatedTableReviewPage() {
  notFound();
}
