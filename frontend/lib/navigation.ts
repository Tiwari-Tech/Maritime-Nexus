export interface NavItem {
  name: string;
  href: string;
  icon:
    | "dashboard"
    | "documents"
    | "ai-assistant"
    | "voyages"
    | "vessels"
    | "ports"
    | "contracts"
    | "settings";
  description: string;
}

export const MAIN_NAV_ITEMS: NavItem[] = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: "dashboard",
    description: "Operational overview and module access",
  },
  {
    name: "Documents",
    href: "/documents",
    icon: "documents",
    description: "Maritime document repository and upload center",
  },
  {
    name: "AI Assistant",
    href: "/ai-assistant",
    icon: "ai-assistant",
    description: "Grounded contract analysis and RAG copilot",
  },
  {
    name: "Voyages",
    href: "/voyages",
    icon: "voyages",
    description: "Voyage tracking and laytime estimation",
  },
  {
    name: "Vessels",
    href: "/vessels",
    icon: "vessels",
    description: "Fleet registry, vessel specifications and status",
  },
  {
    name: "Ports",
    href: "/ports",
    icon: "ports",
    description: "Port directory, berths, and terminal info",
  },
  {
    name: "Contracts",
    href: "/contracts",
    icon: "contracts",
    description: "Charter parties, demurrage terms and clauses",
  },
];

export const SECONDARY_NAV_ITEMS: NavItem[] = [
  {
    name: "Settings",
    href: "/settings",
    icon: "settings",
    description: "Workspace preferences and organization settings",
  },
];

export function getNavItemByPath(pathname: string): NavItem | undefined {
  const all = [...MAIN_NAV_ITEMS, ...SECONDARY_NAV_ITEMS];
  return all.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );
}
