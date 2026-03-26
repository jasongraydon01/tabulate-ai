"use client";

import { authSignOutAction } from "@/app/auth/actions";

export function SignOutButton() {
  return (
    <button
      onClick={() => authSignOutAction()}
      className="text-sm font-medium px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
    >
      Sign in with a different account
    </button>
  );
}
