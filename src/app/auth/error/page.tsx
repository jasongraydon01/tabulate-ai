import Link from "next/link";
import { SignOutButton } from "./sign-out-button";

const ERROR_MESSAGES: Record<string, { title: string; description: string }> = {
  "no-org": {
    title: "No organization found",
    description:
      "Your account is not assigned to an organization. Contact your administrator to be added to one.",
  },
  "callback-failed": {
    title: "Sign-in failed",
    description:
      "Something went wrong during sign-in. Please try again, or contact support if the problem persists.",
  },
  "removed": {
    title: "Access removed",
    description:
      "Your access to this organization has been revoked. Contact your administrator if you believe this is an error.",
  },
};

const DEFAULT_ERROR = {
  title: "Authentication error",
  description:
    "An unexpected error occurred. Please try signing in again.",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const error = (reason && ERROR_MESSAGES[reason]) || DEFAULT_ERROR;

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="flex size-10 items-center justify-center rounded bg-primary text-primary-foreground font-serif text-lg">
            Ct
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {error.title}
          </h1>
          <p className="text-muted-foreground leading-relaxed">
            {error.description}
          </p>
        </div>

        <div className="flex gap-3 justify-center">
          <Link
            href="/"
            className="text-sm font-medium px-4 py-2 rounded-md border border-border hover:bg-secondary transition-colors"
          >
            Back to Home
          </Link>
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
