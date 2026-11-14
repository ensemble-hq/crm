import { Box, Briefcase, Building2, CalendarDays, FileText, FolderClosed, Handshake, type LucideIcon, Package, Star, Ticket, Users, Wrench } from 'lucide-react';

/** Icons an object definition can name. A custom object picks one of these. */
export const objectIcons: Record<string, LucideIcon> = {
  box: Box,
  users: Users,
  building: Building2,
  handshake: Handshake,
  package: Package,
  ticket: Ticket,
  briefcase: Briefcase,
  calendar: CalendarDays,
  file: FileText,
  folder: FolderClosed,
  star: Star,
  wrench: Wrench,
};

export function objectIcon(name: string): LucideIcon {
  return objectIcons[name] ?? Box;
}
