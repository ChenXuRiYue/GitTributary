import {
  CircleHelp,
  Download,
  Globe2,
  Image as ImageIcon,
  Link2,
  Music,
  Video,
} from "lucide-react";

import type { AttachmentItem, AttachmentKind } from "../types";

export function KindIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  const Icon = kind === "image" ? ImageIcon : kind === "audio" ? Music : Link2;
  return <Icon className={className} />;
}

export function AttachmentIcon({ item, className }: { item: AttachmentItem; className?: string }) {
  if (item.kind !== "link") return <KindIcon kind={item.kind} className={className} />;
  const Icon = item.linkKind === "image"
    ? ImageIcon
    : item.linkKind === "audio"
      ? Music
      : item.linkKind === "video"
        ? Video
        : item.linkKind === "website"
          ? Globe2
          : item.linkKind === "download"
            ? Download
            : CircleHelp;
  return <Icon className={className} />;
}
