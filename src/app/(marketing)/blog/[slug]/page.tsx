import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Markdown from 'react-markdown';
import { ArrowLeft } from 'lucide-react';
import { getAllPosts, getPostBySlug } from '@/lib/blog';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${slug}` },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  return (
    <section className="relative overflow-hidden px-6 pt-32 pb-28">
      <div className="absolute inset-0 bg-editorial-radial" />

      <article className="relative max-w-2xl mx-auto">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground/50 tracking-wider uppercase hover:text-foreground transition-colors duration-200 mb-12"
        >
          <ArrowLeft className="h-3 w-3" />
          All posts
        </Link>

        <header className="mb-14">
          <time className="text-xs font-mono text-muted-foreground/50 tracking-wider uppercase">
            {post.date}
          </time>
          <h1 className="editorial-display text-4xl sm:text-5xl mt-3 mb-4">
            {post.title}
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            {post.description}
          </p>
          <div className="h-0.5 w-16 gradient-accent mt-8" />
        </header>

        <div className="prose-blog">
          <Markdown>{post.content}</Markdown>
        </div>
      </article>
    </section>
  );
}
