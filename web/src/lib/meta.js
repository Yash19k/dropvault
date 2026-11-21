// Icons and wording for file kinds and short links, shared by the file list
// and the admin panel so both describe things the same way.
import {
  Image, Video, Music, FileText, FileArchive, FileCode, File as FileIcon, Mail, Link2, QrCode,
} from 'lucide-react';

export const KIND_ICON = {
  image: Image, video: Video, audio: Music, pdf: FileText,
  archive: FileArchive, code: FileCode, document: FileText, file: FileIcon,
};

export const KIND_LABEL = {
  image: 'Image', video: 'Video', audio: 'Audio', pdf: 'PDF',
  archive: 'Archive', code: 'Code', document: 'Document', file: 'File',
};

export const CHANNEL = {
  email: { icon: Mail, label: 'Email' },
  link: { icon: Link2, label: 'Copied link' },
  qr: { icon: QrCode, label: 'QR code' },
};

export const LINK_STATUS = {
  active: { label: 'Active', className: 'bg-accent-soft text-accent' },
  expired: { label: 'Expired', className: 'bg-surface-2 text-muted' },
  revoked: { label: 'Turned off', className: 'bg-surface-2 text-muted' },
  limit_reached: { label: 'Limit reached', className: 'bg-surface-2 text-muted' },
  file_missing: { label: 'Unavailable', className: 'bg-surface-2 text-muted' },
};
