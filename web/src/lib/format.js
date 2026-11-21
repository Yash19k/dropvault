export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Map a file to a coarse kind used to pick an icon + accent color.
export function fileKind(name = '', contentType = '') {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const ct = contentType || '';
  if (ct.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return 'image';
  if (ct.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return 'video';
  if (ct.startsWith('audio/') || ['mp3', 'wav', 'flac', 'ogg', 'm4a'].includes(ext)) return 'audio';
  if (ct === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'tgz'].includes(ext)) return 'archive';
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'java', 'rb', 'sh', 'json', 'yml', 'yaml', 'html', 'css'].includes(ext)) return 'code';
  if (['doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'].includes(ext)) return 'document';
  return 'file';
}

// "just now", "5 min ago", "3 h ago", "2 days ago", then a date. Takes ms epoch.
export function formatRelative(ms) {
  if (!ms) return '';
  const diff = (Date.now() - Number(ms)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 7 * 86400) {
    const days = Math.floor(diff / 86400);
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }
  return new Date(Number(ms)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// 1,284 (in full below 10,000), then 12.9K / 4.2M.
export function formatCount(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) < 10000) return v.toLocaleString();
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

// "21 Nov 2026, 14:05" from a ms epoch.
export function formatDateTime(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// "Nov 21" for a UTC day like "2026-11-21" (the admin stats are kept per UTC day).
export function formatDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  if (isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export const plural = (n, one, many = `${one}s`) => `${formatCount(n)} ${Number(n) === 1 ? one : many}`;
