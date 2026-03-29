import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Demo Status',
  description:
    'Check the processing status of your TabulateAI demo run and download results when ready.',
  robots: { index: false, follow: false },
};

export default function DemoStatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
