"use client";

import { useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import {
  LayoutDashboard,
  PlusCircle,
  Settings,
  Loader2,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  XCircle,
  Clock,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useAuthContext } from "@/providers/auth-provider";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getProductEntryCta } from "@/lib/billing/pricingFlow";

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <CheckCircle className="h-3 w-3 text-tab-teal" />;
    case "partial":
      return <AlertCircle className="h-3 w-3 text-tab-amber" />;
    case "error":
      return <AlertCircle className="h-3 w-3 text-tab-rose" />;
    case "in_progress":
    case "resuming":
      return <Loader2 className="h-3 w-3 text-primary animate-spin" />;
    case "pending_review":
      return <AlertTriangle className="h-3 w-3 text-tab-amber" />;
    case "cancelled":
      return <XCircle className="h-3 w-3 text-muted-foreground" />;
    default:
      return <Clock className="h-3 w-3 text-muted-foreground" />;
  }
}

function formatRelativeTime(timestampMs: number): string {
  const now = Date.now();
  const diffMs = now - timestampMs;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return diffDays === 1 ? "1d ago" : `${diffDays}d ago`;
  if (diffHours > 0) return diffHours === 1 ? "1h ago" : `${diffHours}h ago`;
  if (diffMinutes > 0)
    return diffMinutes === 1 ? "1m ago" : `${diffMinutes}m ago`;
  return "Just now";
}

interface SidebarProject {
  projectId: string;
  name: string;
  createdAt: number;
  status: string;
}

export function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { convexOrgId, hasActiveSubscription, role } = useAuthContext();

  const projects = useQuery(
    api.projects.listByOrg,
    convexOrgId ? { orgId: convexOrgId as Id<"organizations"> } : "skip",
  );

  const runs = useQuery(
    api.runs.listByOrg,
    convexOrgId ? { orgId: convexOrgId as Id<"organizations"> } : "skip",
  );

  const recentProjects: SidebarProject[] = useMemo(() => {
    if (!projects || !runs) return [];

    const latestRunByProject = new Map<string, (typeof runs)[number]>();
    for (const run of runs) {
      const pid = String(run.projectId);
      if (!latestRunByProject.has(pid)) {
        latestRunByProject.set(pid, run);
      }
    }

    return projects
      .map((project) => {
        const latestRun = latestRunByProject.get(String(project._id));
        return {
          projectId: String(project._id),
          name: project.name,
          createdAt: project._creationTime,
          status: latestRun?.status || "pending",
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);
  }, [projects, runs]);

  const isLoading = projects === undefined || runs === undefined;
  const createProjectCta = getProductEntryCta({
    canCreateProject: role === 'admin' || role === 'member',
    hasActiveSubscription,
  });

  const handleProjectClick = (project: SidebarProject) => {
    if (project.status === "pending_review") {
      router.push(`/projects/${encodeURIComponent(project.projectId)}/review`);
    } else {
      router.push(`/projects/${encodeURIComponent(project.projectId)}`);
    }
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => router.push("/dashboard")}
              className="cursor-pointer"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-serif text-sm font-semibold">
                T
              </div>
              <div className="flex items-center gap-0.5 leading-none">
                <span className="font-serif font-semibold tracking-tight">Tabulate</span>
                <span className="font-serif font-semibold tracking-tight text-primary">AI</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Nav */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/dashboard"}
                  onClick={() => router.push("/dashboard")}
                  className="cursor-pointer"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={createProjectCta?.href === "/projects/new" && pathname === "/projects/new"}
                  onClick={() => router.push(createProjectCta?.href ?? "/pricing")}
                  className="cursor-pointer"
                >
                  <PlusCircle className="h-4 w-4" />
                  <span>{createProjectCta?.label ?? 'Choose Plan'}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Recent Projects */}
        <SidebarGroup>
          <SidebarGroupLabel>Recent Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading ? (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-muted-foreground">Loading...</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : recentProjects.length === 0 ? (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <span className="text-muted-foreground text-xs">
                      No projects yet
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : (
                recentProjects.map((project) => (
                  <SidebarMenuItem key={project.projectId}>
                    <SidebarMenuButton
                      onClick={() => handleProjectClick(project)}
                      className="cursor-pointer pr-16"
                      isActive={pathname?.includes(project.projectId)}
                    >
                      <StatusIcon status={project.status} />
                      <span className="truncate">{project.name}</span>
                    </SidebarMenuButton>
                    <SidebarMenuBadge>
                      {formatRelativeTime(project.createdAt)}
                    </SidebarMenuBadge>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === "/settings"}
              onClick={() => router.push("/settings")}
              className="cursor-pointer"
            >
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
