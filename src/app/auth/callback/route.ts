import { handleAuth } from "@workos-inc/authkit-nextjs";

// Derive base URL from the WorkOS redirect URI (strip /auth/callback path).
// In Docker containers, request.nextUrl resolves to the internal hostname (0.0.0.0:3000)
// instead of the public domain, so we must provide baseURL explicitly.
const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
const baseURL = redirectUri
  ? redirectUri.replace(/\/auth\/callback$/, "")
  : undefined;

export const GET = handleAuth({
  returnPathname: "/dashboard",
  baseURL,
  onError: ({ error }) => {
    console.error("[Auth Callback] Error during authentication:", error);
    return new Response(null, {
      status: 302,
      headers: { Location: "/auth/error?reason=callback-failed" },
    });
  },
});
