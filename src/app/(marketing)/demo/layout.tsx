import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Free Demo — Try Automated Crosstabs on Your Data',
  description:
    'Upload your .sav file and survey document. TabulateAI processes 100 respondents and delivers 25 publication-ready crosstabs to your inbox.',
  alternates: { canonical: '/demo' },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
