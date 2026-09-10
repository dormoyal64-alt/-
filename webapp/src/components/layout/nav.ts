import {
  LayoutDashboard,
  Briefcase,
  PlusCircle,
  Users,
  Wallet,
  BarChart3,
  Trophy,
  CalendarRange,
  Bell,
  Settings,
  Tags,
  MapPin,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const mainNav: NavItem[] = [
  { href: "/dashboard", label: "בית", icon: LayoutDashboard },
  { href: "/jobs", label: "עבודות", icon: Briefcase },
  { href: "/jobs/new", label: "הוספת עבודה", icon: PlusCircle },
  { href: "/contractors", label: "קבלנים", icon: Users },
];

export const reportsNav: NavItem[] = [
  { href: "/analytics", label: "אנליטיקס", icon: BarChart3 },
  { href: "/leaderboard", label: "דירוג קבלנים", icon: Trophy },
  { href: "/daily-summary", label: "סיכום יומי", icon: CalendarRange },
  { href: "/settlements", label: "התחשבנות", icon: Wallet },
];

export const settingsNav: NavItem[] = [
  { href: "/settings/professions", label: "תחומים וסוגי עבודות", icon: Tags },
  { href: "/settings/cities", label: "ערים", icon: MapPin },
  { href: "/settings", label: "הגדרות כלליות", icon: Settings },
];

export const utilityNav: NavItem[] = [{ href: "/notifications", label: "התראות", icon: Bell }];

export const sidebarSections = [
  { title: undefined, items: mainNav },
  { title: "דוחות וניהול כספי", items: reportsNav },
  { title: "הגדרות", items: settingsNav },
  { title: undefined, items: utilityNav },
];
