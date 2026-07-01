 ;

import * as React from "react";
import { useLocation } from "react-router-dom";
import { Link } from "react-router-dom";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarMenu,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  LayoutGridIcon,
  FolderIcon,
  FileTextIcon,
  HelpCircleIcon,
  EyeIcon,
  PanelLeftIcon,
  FileIcon,
  SparklesIcon,
  CoinsIcon,
  ReceiptText,
  LifeBuoy,
  BookOpenIcon,
} from "lucide-react";
import { Separator } from "./ui/separator";
import { useUser } from "@clerk/clerk-react";
import { cn } from "@/lib/utils";

const navInterviews = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutGridIcon,
    iconColor: "text-brand",
    iconBg: "bg-brand/10",
  },
  {
    title: "Sessions",
    url: "/sessions",
    icon: FolderIcon,
    iconColor: "text-blue-600",
    iconBg: "bg-blue-100",
    creditLabel: "~2 cr/min",
  },
  {
    title: "Question Bank",
    url: "/questions",
    icon: HelpCircleIcon,
    iconColor: "text-orange-600",
    iconBg: "bg-orange-100",
    isActive: false,
    items: [
      { title: "Explore", url: "/questions/all" },
      { title: "My Questions", url: "/questions/user" },
    ],
  },
];

const navCareer = [
  {
    title: "Resume Studio",
    url: "/resume/build",
    icon: FileTextIcon,
    iconColor: "text-emerald-600",
    iconBg: "bg-emerald-100",
  },
  {
    title: "AI Projects",
    url: "/ai-projects",
    icon: SparklesIcon,
    iconColor: "text-violet-600",
    iconBg: "bg-violet-100",
    creditLabel: "~5 cr",
  },
  {
    title: "Document",
    url: "/document",
    icon: FileIcon,
    iconColor: "text-slate-600",
    iconBg: "bg-slate-100",
  },
  {
    title: "Assistant",
    url: "/assistant",
    icon: SparklesIcon,
    iconColor: "text-purple-600",
    iconBg: "bg-purple-100",
    creditLabel: "~1 cr/msg",
  },
];

const navAccount = [
  {
    title: "Billing",
    url: "/account/usage",
    icon: ReceiptText,
    iconColor: "text-indigo-600",
    iconBg: "bg-indigo-100",
  },
  {
    title: "Credits",
    url: "/billing",
    icon: CoinsIcon,
    iconColor: "text-yellow-600",
    iconBg: "bg-yellow-100",
  },
  {
    title: "Help & Manual",
    url: "/help",
    icon: BookOpenIcon,
    iconColor: "text-sky-600",
    iconBg: "bg-sky-100",
  },
  {
    title: "Support",
    url: "/support",
    icon: LifeBuoy,
    iconColor: "text-rose-600",
    iconBg: "bg-rose-100",
  },
];

interface NavSubItem {
  title: string;
  url: string;
  creditLabel?: string;
}

interface NavItem {
  title: string;
  url: string;
  icon?: React.ElementType;
  iconColor?: string;
  iconBg?: string;
  creditLabel?: string;
  items?: NavSubItem[];
}

function withActive(
  items: NavItem[],
  pathname: string,
): (NavItem & { isActive: boolean; items?: (NavSubItem & { isActive: boolean })[] })[] {
  return items.map((item) => ({
    ...item,
    isActive:
      pathname === item.url ||
      (item.items?.some((s) => pathname === s.url) ?? false),
    items: item.items?.map((s) => ({ ...s, isActive: pathname === s.url })),
  }));
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { setOpen, state, toggleSidebar } = useSidebar();
  const { user } = useUser();
  console.log(user?.id);

  const handleLogoClick = () => {
    if (state === "collapsed") setOpen(true);
  };

  const location = useLocation();
  const pathname = location.pathname;

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* ── Header ── */}
      <SidebarHeader className="h-14 flex justify-center">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-3 px-2 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center">
              <button
                onClick={handleLogoClick}
                className="flex aspect-square size-8 items-center justify-center rounded-lg bg-brand text-white shadow-sm transition-all hover:opacity-90 active:scale-95 group-data-[collapsible=icon]:cursor-pointer"
              >
                <EyeIcon className="size-4" />
              </button>
              <div className="flex flex-1 items-center justify-between group-data-[collapsible=icon]:hidden">
                <div className="flex items-center gap-1.5">
                  <span className="font-serif text-[16px] text-[#1B1B3A]">
                    HireShade
                  </span>
                  <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                    Beta
                  </span>
                </div>
                <button
                  onClick={toggleSidebar}
                  className="rounded-md p-1 hover:bg-muted transition-colors cursor-pointer"
                >
                  <PanelLeftIcon className="size-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <Separator />

      {/* ── Content: three groups ── */}
      <SidebarContent className="flex flex-col">
        {/* INTERVIEWS */}
        <SidebarGroup className="pb-0">
          <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground/60 px-3 py-3 mb-0">
            Interviews
          </SidebarGroupLabel>
          <NavMain items={withActive(navInterviews, pathname)} />
        </SidebarGroup>

        {/* CAREER TOOLS */}
        <SidebarGroup className="pb-0">
          <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground/60 px-3 py-3 mb-0">
            Career Tools
          </SidebarGroupLabel>
          <NavMain items={withActive(navCareer, pathname)} />
        </SidebarGroup>

        {/* ACCOUNT — pinned to bottom */}
        <div className="mt-auto">
          <Separator className="my-1" />
          <SidebarGroup className="py-1">
            <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground/60 px-3 mb-1">
              Account
            </SidebarGroupLabel>
            {navAccount.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.url;
              return (
                <SidebarMenuItem key={item.url} className="list-none">
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={item.title}
                    className={cn(
                      "gap-2",
                      isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                    )}
                  >
                    <Link to={item.url} className="flex items-center gap-2">
                      <span className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-md shrink-0",
                        item.iconBg,
                      )}>
                        <Icon className={cn("h-3.5 w-3.5", item.iconColor)} />
                      </span>
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarGroup>
        </div>
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
