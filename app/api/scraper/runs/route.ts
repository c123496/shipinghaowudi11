import { NextResponse } from 'next/server';
import { getAllRuns } from '@/lib/scraper-storage';

export async function GET() {
  const runs = getAllRuns();
  return NextResponse.json(runs);
}
