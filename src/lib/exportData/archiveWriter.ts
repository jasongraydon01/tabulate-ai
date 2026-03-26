import { createHash } from 'crypto';
import yazl from 'yazl';

export interface ArchiveEntry {
  relativePath: string;
  content: string | Buffer;
}

export interface ArchiveResult {
  buffer: Buffer;
  hash: string;
  entryCount: number;
}

const FIXED_TIMESTAMP = new Date('2000-01-01T00:00:00Z');

export async function createDeterministicArchive(
  entries: ArchiveEntry[],
  fixedTimestamp: Date = FIXED_TIMESTAMP,
): Promise<ArchiveResult> {
  const sortedEntries = [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const zipFile = new yazl.ZipFile();

  for (const entry of sortedEntries) {
    const buf = typeof entry.content === 'string'
      ? Buffer.from(entry.content, 'utf8')
      : entry.content;

    const isSav = entry.relativePath.endsWith('.sav');
    zipFile.addBuffer(buf, entry.relativePath, {
      mtime: fixedTimestamp,
      compress: !isSav,
    });
  }

  zipFile.end();

  const buffer = await streamToBuffer(zipFile.outputStream);
  const hash = createHash('sha256').update(buffer).digest('hex');

  return {
    buffer,
    hash,
    entryCount: sortedEntries.length,
  };
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
