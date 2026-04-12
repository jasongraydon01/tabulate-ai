"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { ModeToggle } from "@/components/mode-toggle";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useEffect, useState } from "react";
import { buildSignInPath } from "@/lib/navigation";
import { getMarketingPrimaryCta, getMarketingSecondaryCta } from "@/lib/navigation";

export function MarketingHeader({
  isAuthenticated,
  hasWorkspaceAccess,
}: {
  isAuthenticated: boolean;
  hasWorkspaceAccess: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);
  const primaryCta = getMarketingPrimaryCta({ isAuthenticated, hasWorkspaceAccess });
  const secondaryCta = getMarketingSecondaryCta({ isAuthenticated, hasWorkspaceAccess });
  const signInHref = buildSignInPath('/dashboard');

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-background/80 backdrop-blur-2xl border-b border-primary/[0.06]"
          : "bg-transparent backdrop-blur-none border-b border-transparent"
      }`}
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-0.5 group"
          >
            <span className="font-serif text-xl font-semibold tracking-tight text-foreground transition-all duration-300 group-hover:tracking-wide">
              Tabulate
            </span>
            <span className="font-serif text-xl font-semibold tracking-tight text-primary transition-all duration-300 group-hover:tracking-wide">
              AI
            </span>
          </Link>

          {/* Center nav — desktop only */}
          <nav className="hidden md:flex items-center gap-10">
            {[
              { href: "/#how-it-works", label: "How It Works" },
              { href: "/#features", label: "Features" },
              { href: "/pricing", label: "Pricing" },
              { href: "/blog", label: "Blog" },
              { href: "/contact", label: "Contact" },
              { href: "/data-privacy", label: "Security" },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="relative text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-200 group"
              >
                {link.label}
                <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-primary transition-all duration-300 group-hover:w-full" />
              </Link>
            ))}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-3">
            {secondaryCta && (
              <Link
                href={secondaryCta.href}
                className="hidden md:inline text-[13px] font-medium text-primary hover:text-primary/80 transition-colors duration-200"
              >
                {secondaryCta.label}
              </Link>
            )}
            {!isAuthenticated && (
              <Link
                href={signInHref}
                className="hidden md:inline text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors duration-200"
              >
                Sign In
              </Link>
            )}
            <Link
              href={primaryCta.href}
              className="hidden sm:inline-flex items-center text-[13px] font-medium bg-foreground text-background px-4 py-2 rounded-full hover:bg-foreground/90 transition-all duration-200"
            >
              {primaryCta.label}
            </Link>
            <ModeToggle />

            {/* Mobile menu */}
            <Sheet>
              <SheetTrigger asChild>
                <button
                  className="md:hidden p-1.5 rounded-md hover:bg-accent transition-colors"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-3/4 sm:max-w-sm">
                <nav className="flex flex-col gap-6 mt-8">
                  <SheetClose asChild>
                    <Link
                      href="/#how-it-works"
                      className="text-base text-muted-foreground hover:text-foreground transition-colors"
                    >
                      How It Works
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link
                      href="/#features"
                      className="text-base text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Features
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link
                      href="/pricing"
                      className="text-base text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Pricing
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link
                      href="/blog"
                      className="text-base text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Blog
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link
                      href="/contact"
                      className="text-base text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Contact
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link
                      href="/data-privacy"
                      className="text-base text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Security
                    </Link>
                  </SheetClose>
                  {secondaryCta && (
                    <SheetClose asChild>
                      <Link
                        href={secondaryCta.href}
                        className="text-base font-medium text-primary"
                      >
                        {secondaryCta.label}
                      </Link>
                    </SheetClose>
                  )}
                  {!isAuthenticated && (
                    <SheetClose asChild>
                      <Link
                        href={signInHref}
                        className="text-base font-medium text-muted-foreground"
                      >
                        Sign In
                      </Link>
                    </SheetClose>
                  )}
                  <SheetClose asChild>
                    <Link
                      href={primaryCta.href}
                      className="text-base font-medium text-foreground"
                    >
                      {primaryCta.label}
                    </Link>
                  </SheetClose>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
