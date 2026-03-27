import { getAuth, getSessionAuth } from "@/lib/auth";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingThreadLine } from "./_components/marketing-thread-line";

export const dynamic = 'force-dynamic';

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sessionAuth, auth] = await Promise.all([getSessionAuth(), getAuth()]);
  const isAuthenticated = !!sessionAuth;
  const hasWorkspaceAccess = !!auth;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader
        isAuthenticated={isAuthenticated}
        hasWorkspaceAccess={hasWorkspaceAccess}
      />
      <MarketingThreadLine />
      <main>{children}</main>
    </div>
  );
}
