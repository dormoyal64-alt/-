import {
  LayoutDashboard,
  Briefcase,
  PlusCircle,
  Users,
  Wallet,
  BarChart3,
  Trophy,
  CalendarRange,
  CalendarClock,
  Bell,
  Settings,
  Tags,
  MapPin,
  Megaphone,
  PiggyBank,
  Fuel,
  Building2,
  UserCog,
  Scale,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** true when the page is about money, and office staff should not see it */
  ownerOnly?: boolean;
}

export const mainNav: NavItem[] = [
  { href: "/dashboard", label: "בית", icon: LayoutDashboard },
  { href: "/jobs", label: "עבודות", icon: Briefcase },
  { href: "/schedule", label: "לוח זמנים", icon: CalendarClock },
  { href: "/jobs/new", label: "הוספת עבודה", icon: PlusCircle },
  { href: "/contractors", label: "קבלנים", icon: Users },
];

export const reportsNav: NavItem[] = [
  { href: "/balance", label: "מאזן — נכנס ויצא", icon: Scale, ownerOnly: true },
  { href: "/profit", label: "רווח נקי", icon: PiggyBank, ownerOnly: true },
  { href: "/expenses", label: "הוצאות קבועות", icon: Wallet, ownerOnly: true },
  { href: "/advertising", label: "הוצאות פרסום", icon: Megaphone, ownerOnly: true },
  { href: "/referrals", label: "חברות מפנות", icon: Building2, ownerOnly: true },
  { href: "/analytics", label: "אנליטיקס", icon: BarChart3, ownerOnly: true },
  { href: "/leaderboard", label: "דירוג קבלנים", icon: Trophy, ownerOnly: true },
  { href: "/daily-summary", label: "סיכומים", icon: CalendarRange, ownerOnly: true },
  { href: "/settlements", label: "התחשבנות", icon: Wallet, ownerOnly: true },
];

export const settingsNav: NavItem[] = [
  { href: "/settings/professions", label: "תחומים וסוגי עבודות", icon: Tags },
  { href: "/settings/cities", label: "ערים", icon: MapPin },
  { href: "/settings/vehicle", label: "רכב, דלק ועובדים", icon: Fuel, ownerOnly: true },
  { href: "/settings/users", label: "משתמשים והרשאות", icon: UserCog, ownerOnly: true },
  { href: "/settings", label: "הגדרות כלליות", icon: Settings, ownerOnly: true },
];

export const utilityNav: NavItem[] = [{ href: "/notifications", label: "התראות", icon: Bell }];

export const sidebarSections = [
  { title: undefined, items: mainNav },
  { title: "דוחות וניהול כספי", items: reportsNav },
  { title: "הגדרות", items: settingsNav },
  { title: undefined, items: utilityNav },
];

/** The sections as this user should see them; empty sections drop out. */
export function sectionsForRole(isOwner: boolean) {
  return sidebarSections
    .map((section) => ({ ...section, items: section.items.filter((i) => isOwner || !i.ownerOnly) }))
    .filter((section) => section.items.length > 0);
}

/** Pages office staff must not land on, even by typing the address. */
export const ownerOnlyPaths = [
  ...reportsNav.filter((i) => i.ownerOnly).map((i) => i.href),
  ...settingsNav.filter((i) => i.ownerOnly).map((i) => i.href),
];
