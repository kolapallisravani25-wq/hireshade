import { Link } from "react-router-dom"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { ChevronRightIcon, Coins } from "lucide-react"
import { cn } from "@/lib/utils"

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon?: React.ElementType
    iconColor?: string
    iconBg?: string
    creditLabel?: string
    isActive?: boolean
    items?: {
      title: string
      url: string
      isActive?: boolean
      creditLabel?: string
    }[]
  }[]
}) {
  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => {
          const hasSubItems = item.items && item.items.length > 0

          if (!hasSubItems) {
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild tooltip={item.title} isActive={item.isActive}>
                  <Link to={item.url} className="flex items-center gap-2 w-full">
                    {item.icon && (
                      <span className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-md shrink-0",
                        item.iconBg ?? "bg-transparent",
                      )}>
                        <item.icon className={cn("h-3.5 w-3.5", item.iconColor ?? "text-muted-foreground")} />
                      </span>
                    )}
                    <span className="flex-1 truncate">{item.title}</span>
                    {item.creditLabel && (
                      <span className="flex items-center gap-0.5 rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 shrink-0 group-data-[collapsible=icon]:hidden">
                        <Coins className="h-2.5 w-2.5" />
                        {item.creditLabel}
                      </span>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          }

          return (
            <Collapsible
              key={item.title}
              asChild
              defaultOpen={item.isActive}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title} isActive={item.isActive}>
                    {item.icon && (
                      <span className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-md shrink-0",
                        item.iconBg ?? "bg-transparent",
                      )}>
                        <item.icon className={cn("h-3.5 w-3.5", item.iconColor ?? "text-muted-foreground")} />
                      </span>
                    )}
                    <span className="flex-1 truncate">{item.title}</span>
                    <ChevronRightIcon className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 shrink-0" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton asChild isActive={subItem.isActive}>
                          <Link to={subItem.url} className="flex items-center gap-2 w-full">
                            <span className="flex-1 truncate">{subItem.title}</span>
                            {subItem.creditLabel && (
                              <span className="flex items-center gap-0.5 rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 shrink-0">
                                <Coins className="h-2.5 w-2.5" />
                                {subItem.creditLabel}
                              </span>
                            )}
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
