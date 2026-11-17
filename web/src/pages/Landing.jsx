import { Link } from 'react-router-dom';
import {
  ArrowRight, Download, Mail, Link2, QrCode, FileText, FileArchive, Video, Image,
  UploadCloud, Clock, Lock, ShieldCheck, Github,
} from 'lucide-react';
import { Logo } from '../components/ui';
import { ThemeToggle } from '../theme';
import { useAuth } from '../context/AuthContext';
import { APP_NAME, REPO_URL } from '../brand';

const steps = [
  { n: '01', title: 'Upload', text: 'Drag files in or pick them from your computer. They go straight to private storage, up to 5 GB each.' },
  { n: '02', title: 'Share', text: 'Email a link, copy it, or show a QR code that someone can scan from across the table.' },
  { n: '03', title: 'It expires', text: 'Links stop working after an hour, and immediately if you delete the file.' },
];

const features = [
  { icon: UploadCloud, title: 'Direct uploads', text: 'Files go from your browser straight to storage, so large uploads don’t stall on a server.' },
  { icon: Mail, title: 'Email sharing', text: 'Send a file to several people at once. Each gets a plain email with a download link.' },
  { icon: QrCode, title: 'QR codes', text: 'Every file has a short, scannable link. Handy for moving a file from laptop to phone.' },
  { icon: Clock, title: 'Links that expire', text: 'Download links last one hour. Nothing stays shareable longer than it needs to.' },
  { icon: Lock, title: 'Private by default', text: 'Your files are only visible to you. There are no public folders to misconfigure.' },
  { icon: ShieldCheck, title: 'Encrypted at rest', text: 'Files are stored encrypted on Amazon S3, in a bucket only the app can reach.' },
];

const previewFiles = [
  { icon: FileText, name: 'Q3-financial-report.pdf', size: '2.4 MB', date: 'Nov 17' },
  { icon: FileArchive, name: 'site-photos-final.zip', size: '418 MB', date: 'Nov 16' },
  { icon: Video, name: 'product-demo.mp4', size: '1.2 GB', date: 'Nov 14' },
  { icon: Image, name: 'floor-plan-v3.png', size: '3.1 MB', date: 'Nov 12' },
];

export default function Landing() {
  const { isAuthenticated } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" aria-label={`${APP_NAME} home`}><Logo /></Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:block"><ThemeToggle /></div>
            {isAuthenticated ? (
              <Link to="/app" className="btn-primary">Open app <ArrowRight className="h-4 w-4" /></Link>
            ) : (
              <>
                <Link to="/login" className="btn-ghost">Sign in</Link>
                <Link to="/signup" className="btn-primary">Get started</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-[1fr_1.05fr] lg:py-24">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-accent">File sharing on AWS</p>
            <h1 className="mt-4 max-w-xl text-[2.6rem] font-semibold leading-[1.08] tracking-tight sm:text-5xl">
              Share files with links that expire.
            </h1>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-muted">
              Upload files up to 5 GB, send them by email or QR code, and every link stops working after an hour.
              Nothing stays out there longer than it needs to.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {isAuthenticated ? (
                <Link to="/app" className="btn-primary h-10 px-5">Go to your files <ArrowRight className="h-4 w-4" /></Link>
              ) : (
                <>
                  <Link to="/signup" className="btn-primary h-10 px-5">Create a free account</Link>
                  <Link to="/login" className="btn-secondary h-10 px-5">Sign in</Link>
                </>
              )}
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-line pt-6">
              {[['5 GB', 'per file'], ['1 hour', 'link lifetime'], ['AES-256', 'encryption']].map(([v, k]) => (
                <div key={k}>
                  <dt className="sr-only">{k}</dt>
                  <dd className="font-mono text-lg font-medium">{v}</dd>
                  <dd className="mt-0.5 text-xs text-muted">{k}</dd>
                </div>
              ))}
            </dl>
          </div>

          <ProductPreview />
        </section>

        {/* How it works */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
            <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-10">
              {steps.map((s) => (
                <li key={s.n} className="border-t-2 border-fg pt-5">
                  <span className="font-mono text-xs text-muted">{s.n}</span>
                  <h3 className="mt-2 text-base font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold tracking-tight">Built for sending things, not storing them forever</h2>
              <p className="mt-3 text-muted">The parts that matter when you need to get a file to someone quickly and safely.</p>
            </div>
            <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="flex gap-4">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-surface text-accent">
                    <f.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-semibold">{f.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        {!isAuthenticated && (
          <section className="border-t border-line bg-surface">
            <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-14 md:flex-row md:items-center">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Send your first file in under a minute.</h2>
                <p className="mt-1.5 text-sm text-muted">Name, email and a password. That’s the whole sign-up.</p>
              </div>
              <Link to="/signup" className="btn-primary h-10 px-5">Create a free account <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="text-subtle">© {new Date().getFullYear()}</span>
          </div>
          <div className="flex items-center gap-5">
            <div className="sm:hidden"><ThemeToggle /></div>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-fg">
              <Github className="h-4 w-4" /> Source on GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// A static, to-scale picture of the real file screen (no stock art, no blobs).
function ProductPreview() {
  return (
    <div className="relative sm:mb-8 lg:mb-0" aria-hidden="true">
      <div className="panel overflow-hidden shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="text-sm font-semibold">All files</div>
            <div className="mt-0.5 font-mono text-[11px] text-muted">4 files · 1.6 GB</div>
          </div>
          <span className="btn-primary pointer-events-none h-8 px-3 text-xs">Upload</span>
        </div>
        <ul className="divide-y divide-line">
          {previewFiles.map((f, i) => (
            <li key={f.name} className={`flex items-center gap-3 px-4 py-3 ${i === 1 ? 'bg-surface-2' : ''}`}>
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted">
                <f.icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{f.name}</div>
                <div className="font-mono text-[11px] text-subtle">{f.size} · {f.date}</div>
              </div>
              <div className="hidden items-center gap-0.5 text-muted sm:flex">
                {[Download, Mail, Link2, QrCode].map((I, k) => (
                  <span key={k} className={`grid h-7 w-7 place-items-center rounded ${i === 1 && k === 3 ? 'bg-line text-fg' : ''}`}>
                    <I className="h-3.5 w-3.5" />
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* QR popover anchored to the highlighted row */}
      <div className="panel absolute -bottom-8 -right-4 hidden w-52 p-3 shadow-lg sm:block">
        <div className="flex items-center gap-2 text-xs font-medium"><QrCode className="h-3.5 w-3.5 text-muted" /> Scan to download</div>
        <div className="mt-2.5 rounded border border-line bg-white p-2">
          <FakeQr />
        </div>
        <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-muted">
          <Clock className="h-3 w-3" /> Expires in 59 min
        </div>
      </div>
    </div>
  );
}

// Decorative QR-like grid (deterministic, not a real code).
function FakeQr() {
  const n = 25;
  const cells = [];
  const finder = (x, y) => [[0, 0], [n - 7, 0], [0, n - 7]].some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
  const finderOn = (x, y) => {
    for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      const dx = x - fx; const dy = y - fy;
      if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) {
        return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
      }
    }
    return false;
  };
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const quiet = (x === 7 || y === 7 || x === n - 8) && (finder(x - 1, y) || finder(x, y - 1) || finder(x + 1, y));
      const h = Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 0;
      const on = finder(x, y) ? finderOn(x, y) : !quiet && (h % 100) < 47;
      if (on) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
    }
  }
  return <svg viewBox={`0 0 ${n} ${n}`} className="block h-auto w-full" fill="#1b1b18" shapeRendering="crispEdges">{cells}</svg>;
}
