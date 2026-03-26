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
import { isPreviewFeatureEnabled } from "@/lib/featureGates";
import { useEffect, useState } from "react";

/** @temporary — showPreview controls visibility of Pricing + Demo nav links */
const showPreview = isPreviewFeatureEnabled();

export function MarketingHeader({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);

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
              ...(showPreview
                ? [{ href: "/pricing", label: "Pricing" }]
                : []),
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
            {showPreview && (
              <Link
                href="/demo"
                className="hidden md:inline text-[13px] font-medium text-primary hover:text-primary/80 transition-colors duration-200"
              >
                Try Demo
              </Link>
            )}
            <Link
              href="/dashboard"
              className="hidden sm:inline-flex items-center text-[13px] font-medium bg-foreground text-background px-4 py-2 rounded-full hover:bg-foreground/90 transition-all duration-200"
            >
              {isAuthenticated ? "Dashboard" : "Get Started"}
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
                  {showPreview && (
                    <SheetClose asChild>
                      <Link
                        href="/pricing"
                        className="text-base text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Pricing
                      </Link>
                    </SheetClose>
                  )}
                  <SheetClose asChild>
                    <Link
                      href="/data-privacy"
                      className="text-base text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Security
                    </Link>
                  </SheetClose>
                  {showPreview && (
                    <SheetClose asChild>
                      <Link
                        href="/demo"
                        className="text-base font-medium text-primary"
                      >
                        Try Demo
                      </Link>
                    </SheetClose>
                  )}
                  <SheetClose asChild>
                    <Link
                      href="/dashboard"
                      className="text-base font-medium text-foreground"
                    >
                      {isAuthenticated ? "Dashboard" : "Get Started"}
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
