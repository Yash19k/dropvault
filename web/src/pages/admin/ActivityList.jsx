// One line per event: sign-ups, uploads, shares, downloads and admin actions.
import { UserPlus, Upload, Download, ShieldCheck } from 'lucide-react';
import { CHANNEL } from '../../lib/meta';
import { formatBytes, formatDateTime, formatRelative } from '../../lib/format';
import { UserLink } from './ui';

export const EVENT_TYPES = {
  all: 'All activity',
  signup: 'Sign-ups',
  upload: 'Uploads',
  share: 'Shares',
  download: 'Downloads',
  admin: 'Admin actions',
};

const FileName = ({ file }) => (
  <span className="font-medium text-fg">{file?.file_name || 'a deleted file'}</span>
);

function describe(e) {
  const who = <UserLink user={e.user} className="font-medium text-fg" />;
  switch (e.type) {
    case 'signup':
      return { icon: UserPlus, text: <>{who} signed up</> };
    case 'upload':
      return { icon: Upload, text: <>{who} uploaded <FileName file={e.file} />{e.file?.size ? <span className="text-muted"> · {formatBytes(e.file.size)}</span> : null}</> };
    case 'share': {
      const channel = CHANNEL[e.channel] || CHANNEL.link;
      if (e.channel === 'email') return { icon: channel.icon, text: <>{who} emailed <FileName file={e.file} /> to {e.recipient}</> };
      if (e.channel === 'qr') return { icon: channel.icon, text: <>{who} made a QR code for <FileName file={e.file} /></> };
      return { icon: channel.icon, text: <>{who} made a link to <FileName file={e.file} /></> };
    }
    case 'download': {
      const times = e.downloads > 1 ? <span className="text-muted"> · {e.downloads} downloads on this link</span> : null;
      if (e.recipient) return { icon: Download, text: <>{e.recipient} downloaded <FileName file={e.file} />{times}</> };
      return { icon: Download, text: <><FileName file={e.file} /> was downloaded through {who}’s link{times}</> };
    }
    case 'admin': {
      const actor = e.actor?.email
        ? <UserLink user={e.actor} className="font-medium text-fg" />
        : <span className="font-medium text-fg">An admin</span>;
      return { icon: ShieldCheck, text: <>{actor} <span className="text-muted">·</span> {e.summary}</> };
    }
    default:
      return { icon: ShieldCheck, text: e.type };
  }
}

export function ActivityItem({ event }) {
  const { icon: Icon, text } = describe(event);
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border ${
        event.type === 'admin' ? 'border-accent/30 bg-accent-soft text-accent' : 'border-line bg-surface-2 text-muted'}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 text-sm text-muted [overflow-wrap:anywhere]">{text}</div>
      <time className="shrink-0 pt-0.5 text-xs text-subtle tabular-nums" dateTime={new Date(event.at).toISOString()} title={formatDateTime(event.at)}>
        {formatRelative(event.at)}
      </time>
    </li>
  );
}

export default function ActivityList({ events }) {
  return (
    <ul className="divide-y divide-line">
      {events.map((e, i) => <ActivityItem key={`${e.type}-${e.at}-${i}`} event={e} />)}
    </ul>
  );
}
