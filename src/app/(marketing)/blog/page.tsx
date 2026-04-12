import type { Metadata } from 'next';
import Link from 'next/link';
import { getAllPosts } from '@/lib/blog';

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'Insights on crosstab automation, survey data processing, and market research workflows from the TabulateAI team.',
  alternates: { canonical: '/blog' },
};

export default function BlogListPage() {
  const posts = getAllPosts();

  return (
    <section className="relative overflow-hidden px-6 pt-32 pb-28">
      <div className="absolute inset-0 bg-editorial-radial" />

      <div className="relative max-w-3xl mx-auto">
        <span className="data-label text-primary mb-4 block">Blog</span>
        <h1 className="editorial-display text-4xl sm:text-5xl lg:text-6xl mb-6">
          From the <span className="editorial-emphasis">TabulateAI</span> team
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl leading-relaxed mb-20">
          Perspectives on crosstab automation, survey data processing, and
          market research workflows.
        </p>

        {posts.length === 0 ? (
          <p className="text-muted-foreground">No posts yet. Check back soon.</p>
        ) : (
          <div className="space-y-12">
            {posts.map((post) => (
              <article key={post.slug} className="group">
                <Link href={`/blog/${post.slug}`} className="block">
                  <time className="text-xs font-mono text-muted-foreground/50 tracking-wider uppercase">
                    {post.date}
                  </time>
                  <h2 className="font-serif text-2xl sm:text-3xl font-light mt-2 mb-3 leading-tight group-hover:text-primary transition-colors duration-200">
                    {post.title}
                  </h2>
                  <p className="text-base text-muted-foreground leading-relaxed">
                    {post.description}
                  </p>
                </Link>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
