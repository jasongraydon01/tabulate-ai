import { getAuth } from "@/lib/auth";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingThreadLine } from "./_components/marketing-thread-line";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getAuth();
  const isAuthenticated = !!auth;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader isAuthenticated={isAuthenticated} />
      <MarketingThreadLine />
      <main>{children}</main>
    </div>
  );
}
