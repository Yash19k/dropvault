import { Link } from 'react-router-dom';
import { ArrowRight, UploadCloud, ShieldCheck, MailCheck, Clock } from 'lucide-react';
import { Logo } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { APP_NAME } from '../brand';

const features = [
  { icon: UploadCloud, title: 'Upload anything', text: 'Drag and drop straight into your private storage - streamed directly to S3 with live progress.' },
  { icon: MailCheck, title: 'Share by email', text: 'Send any file to anyone; they get a clean email with a secure download link.' },
  { icon: Clock, title: 'Links that expire', text: 'Every download link is valid for one hour - share confidently, nothing lingers.' },
  { icon: ShieldCheck, title: 'Secure by default', text: 'Password sign-in; files are private and isolated per user.' },
];

export default function Landing() {
  const { isAuthenticated } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        {isAuthenticated
          ? <Link to="/app" className="btn-primary text-sm">Open app <ArrowRight className="h-4 w-4" /></Link>
          : (
            <div className="flex items-center gap-2">
              <Link to="/login" className="btn-ghost text-sm">Sign in</Link>
              <Link to="/signup" className="btn-primary text-sm">Create account</Link>
            </div>
          )}
      </header>

      <main className="mx-auto max-w-6xl px-5">
        <section className="py-16 text-center sm:py-24">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Secure file sharing on AWS
          </div>
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-bold tracking-tight text-white sm:text-6xl">
            Send files,<br />
            <span className="bg-gradient-to-r from-brand-400 to-sky-400 bg-clip-text text-transparent">securely and simply.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-lg text-slate-400">
            {APP_NAME} stores your files privately and shares them with one-hour download links - protected by mandatory multi-factor sign-in.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {isAuthenticated
              ? <Link to="/app" className="btn-primary">Open app <ArrowRight className="h-4 w-4" /></Link>
              : (
                <>
                  <Link to="/signup" className="btn-primary">Create an account <ArrowRight className="h-4 w-4" /></Link>
                  <Link to="/login" className="btn-ghost">Sign in</Link>
                </>
              )}
          </div>
        </section>

        <section className="grid gap-4 pb-24 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.title} className="card p-6 transition hover:border-brand-500/30 hover:bg-white/[0.05]">
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-brand-500/10 text-brand-400">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-white">{f.title}</h3>
              <p className="mt-1.5 text-sm text-slate-400">{f.text}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-white/5 py-8 text-center text-sm text-slate-500">
        {APP_NAME} · secure file sharing, powered by CognitoApi
      </footer>
    </div>
  );
}
