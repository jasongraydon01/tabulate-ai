"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ModeToggle } from "@/components/mode-toggle";
import { useAuthContext } from "@/providers/auth-provider";
import { signOutAction } from "@/app/(product)/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExternalLink, Inbox, LifeBuoy, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { canPerform } from "@/lib/permissions";

function getInitials(name: string | null, email: string | null): string {
  if (name) {
    return name
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return "?";
}

function roleBadgeVariant(role: string | null) {
  switch (role) {
    case "admin":
      return "default" as const;
    case "external_partner":
      return "outline" as const;
    default:
      return "secondary" as const;
  }
}

function roleLabel(role: string | null) {
  switch (role) {
    case "admin":
      return "Admin";
    case "external_partner":
      return "Partner";
    default:
      return "Member";
  }
}

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { name, email, role, isBypass, isInternalOperator } = useAuthContext();
  const initials = getInitials(name, email);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 !h-4" />
      <div className="flex-1">{children}</div>
      <div className="flex items-center gap-2">
        <ModeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="relative h-8 w-8 rounded-full bg-muted"
            >
              <span className="text-xs font-serif font-medium">{initials}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium leading-none">
                    {name || "User"}
                  </p>
                  <Badge variant={roleBadgeVariant(role)} className="text-[10px] px-1.5 py-0">
                    {roleLabel(role)}
                  </Badge>
                </div>
                <p className="text-xs leading-none text-muted-foreground">
                  {email || ""}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/" className="cursor-pointer">
                <ExternalLink className="mr-2 h-4 w-4" />
                TabulateAI Home
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/contact" className="cursor-pointer">
                <LifeBuoy className="mr-2 h-4 w-4" />
                Contact TabulateAI
              </Link>
            </DropdownMenuItem>
            {canPerform(role, 'view_settings') && (
              <DropdownMenuItem asChild>
                <Link href="/settings" className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
            )}
            {isInternalOperator && (
              <DropdownMenuItem asChild>
                <Link href="/ops/access-requests" className="cursor-pointer">
                  <Inbox className="mr-2 h-4 w-4" />
                  Access Requests
                </Link>
              </DropdownMenuItem>
            )}
            {!isBypass && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => signOutAction()}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
