import { Box, Building2, Handshake, type LucideIcon, Package, Ticket, Users } from 'lucide-react';

/** Icons an object definition can name. A custom object picks one of these, or gets the box. */
const objectIcons: Record<string, LucideIcon> = {
  users: Users,
  building: Building2,
  handshake: Handshake,
  package: Package,
  ticket: Ticket,
};

export function objectIcon(name: string): LucideIcon {
  return objectIcons[name] ?? Box;
}
