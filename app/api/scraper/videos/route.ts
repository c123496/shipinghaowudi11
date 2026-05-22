import { NextResponse } from 'next/server';
import { getAllVideos } from '@/lib/scraper-storage';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videos = getAllVideos({
    grade: searchParams.get('grade') || undefined,
    source: searchParams.get('source') || undefined,
    platform: searchParams.get('platform') || undefined,
    bookTrackOnly: searchParams.get('book_track') === 'true',
    limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100,
  });
  return NextResponse.json(videos);
}
