import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BookOpen,
  Building2,
  CalendarDays,
  CircleHelp,
  FileText,
  Globe2,
  GraduationCap,
  Landmark,
  Megaphone,
  MessageCircle,
  Newspaper,
  PenLine,
  Podcast,
  Tags,
  Users,
  Video,
} from "lucide-react";
import type { EntryType, SourceType } from "@/types";

export const ISSUE_FILTER_ICON = Tags;
export const TYPE_FILTER_ICON = Users;
export const SOURCE_FILTER_ICON = Newspaper;

export const ENTRY_TYPE_ICONS: Record<EntryType, LucideIcon> = {
  campaign: Megaphone,
  event: CalendarDays,
  initiative: BookOpen,
  organization: Building2,
  person: Users,
};

export const SOURCE_TYPE_ICONS: Record<SourceType, LucideIcon> = {
  academic_paper: GraduationCap,
  community_archive: Archive,
  conference: CalendarDays,
  government_record: Landmark,
  news_article: Newspaper,
  op_ed: PenLine,
  org_website: Globe2,
  other: CircleHelp,
  podcast: Podcast,
  report: FileText,
  social_media: MessageCircle,
  video: Video,
};
