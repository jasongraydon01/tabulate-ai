import '../src/lib/loadEnv';

import { streamText } from 'ai';

import { getOpenAIProvider } from '../src/lib/env';

const MODEL = process.env.ANALYSIS_MODEL?.trim() || 'gpt-5.4-2026-03-05';
const SUMMARY = (process.env.ANALYSIS_REASONING_SUMMARY?.trim() as 'auto' | 'detailed' | undefined) || 'auto';
const EFFORT = (process.env.PROBE_REASONING_EFFORT?.trim() as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined) || 'medium';

async function main() {
  console.log('--- probe: openai reasoning summary ---');
  console.log('model:', MODEL);
  console.log('reasoningSummary:', SUMMARY);
  console.log('reasoningEffort:', EFFORT);
  console.log('---');

  const model = getOpenAIProvider().responses(MODEL);

  const omitEffort = process.env.PROBE_OMIT_EFFORT === 'true';
  const openaiOptions = omitEffort
    ? { reasoningSummary: SUMMARY }
    : { reasoningEffort: EFFORT, reasoningSummary: SUMMARY };
  console.log('openaiOptions passed:', openaiOptions);

  const result = streamText({
    model,
    prompt: 'A 20-year bond with a $1,000 face value pays 4% annually. If the market rate rises to 6%, does the bond price go up or down, and roughly by how much in percentage terms? Walk through the reasoning briefly.',
    providerOptions: { openai: openaiOptions },
  });

  const chunkTypeCounts = new Map<string, number>();
  const reasoningDeltaSamples: string[] = [];

  for await (const chunk of result.fullStream) {
    const count = chunkTypeCounts.get(chunk.type) ?? 0;
    chunkTypeCounts.set(chunk.type, count + 1);

    if (chunk.type === 'reasoning-delta') {
      const anyChunk = chunk as unknown as { text?: string; delta?: string };
      const text = anyChunk.text ?? anyChunk.delta ?? '';
      if (text && reasoningDeltaSamples.length < 10) {
        reasoningDeltaSamples.push(text.slice(0, 160));
      }
    }
  }

  const finalResponse = await result.response;
  const finalMessages = finalResponse.messages;
  const lastMessage = finalMessages.at(-1);
  const partTypes = Array.isArray(lastMessage?.content)
    ? lastMessage.content.map((part: { type?: string }) => part.type ?? '(unknown)')
    : ['(non-array content)'];

  const usage = await result.usage;

  console.log('\nchunk type counts:');
  for (const [type, count] of Array.from(chunkTypeCounts.entries()).sort()) {
    console.log(`  ${type}: ${count}`);
  }

  console.log('\nfinal response part types:');
  console.log('  ', partTypes);

  if (reasoningDeltaSamples.length > 0) {
    console.log('\nfirst reasoning-delta samples:');
    for (const s of reasoningDeltaSamples) console.log('  •', s);
  } else {
    console.log('\nno reasoning-delta chunks received.');
  }

  console.log('\nusage:', usage);
}

main().catch((err) => {
  console.error('probe failed:', err);
  process.exit(1);
});
