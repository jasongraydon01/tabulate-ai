/**
 * @deprecated Legacy Review Tables API removed from the product surface in Phase 6.
 */
import { NextResponse } from 'next/server';

export const maxDuration = 600;

export async function POST() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
