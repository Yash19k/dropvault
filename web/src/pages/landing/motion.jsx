import { useEffect, useRef, useState } from 'react';

// Small motion helpers for the landing page. Everything here respects
// prefers-reduced-motion and stops work for things that are off screen.

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

// True while the element is on screen (or, with once, after it first appears).
export function useInView(ref, { once = false, rootMargin = '0px 0px -10% 0px' } = {}) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        if (once) io.disconnect();
      } else if (!once) {
        setInView(false);
      }
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, rootMargin]);
  return inView;
}

// Fades and lifts its children in the first time they scroll into view.
export function Reveal({ as: Tag = 'div', delay = 0, className = '', style, children, ...rest }) {
  const ref = useRef(null);
  const shown = useInView(ref, { once: true });
  return (
    <Tag ref={ref} data-shown={shown ? '' : undefined} className={`reveal ${className}`}
      style={{ '--reveal-delay': `${delay}ms`, ...style }} {...rest}>
      {children}
    </Tag>
  );
}

// Calls fn every `ms` while `active`. Used by the small looping demos.
export function useInterval(fn, ms, active = true) {
  const saved = useRef(fn);
  useEffect(() => { saved.current = fn; }, [fn]);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
