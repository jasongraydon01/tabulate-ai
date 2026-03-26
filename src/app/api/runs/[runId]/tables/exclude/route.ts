/**
 * @deprecated Legacy Review Tables API removed from the product surface in Phase 6.
 */
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
