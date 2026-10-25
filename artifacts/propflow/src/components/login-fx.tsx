import { useEffect, useRef, useState } from 'react';

/**
 * Calm motion for the sign-in / setup screens (ported from the DSRMT and Varasidhi DSR sign-ins).
 * Nothing here reads or shows real data and nothing touches the form: every piece sits behind the
 * card (fixed, pointer-events none) or in space the page already has. All of it is off for people
 * who prefer reduced motion.
 */

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Three slow, faint waves leaning slightly toward the pointer, plus a drifting ticker tape. */
export function LoginBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const cx = cv?.getContext('2d');
    if (!cv || !cx) return;
    let w = 0, h = 0, mx = 0.5, my = 0.5, raf = 0;
    const size = () => {
      const d = window.devicePixelRatio || 1;
      w = window.innerWidth; h = window.innerHeight;
      cv.width = w * d; cv.height = h * d;
      cx.setTransform(d, 0, 0, d, 0, 0);
    };
    const draw = (t: number) => {
      cx.clearRect(0, 0, w, h);
      for (let k = 0; k < 3; k++) {
        const y0 = h * (0.62 + k * 0.1), amp = 8 + k * 3 + Math.abs(mx - 0.5) * 10, sp = (t / 3200) * (1 + k * 0.18);
        cx.beginPath();
        for (let x = 0; x <= w; x += 6) {
          const y = y0 + Math.sin(x / 70 + sp) * amp + Math.sin(x / 190 - sp * 0.7) * amp * 0.8 + (my - 0.5) * 14 * (k / 3);
          if (x) cx.lineTo(x, y); else cx.moveTo(x, y);
        }
        // faint cyan lines; the middle one uses the theme orange
        cx.strokeStyle = k === 1 ? 'hsla(16,100%,56%,.5)' : 'hsla(188,86%,53%,.16)';
        cx.lineWidth = k === 1 ? 1.5 : 1;
        cx.stroke();
      }
    };
    const loop = (t: number) => { if (!document.hidden) draw(t); raf = requestAnimationFrame(loop); };
    const move = (e: PointerEvent) => { mx = e.clientX / w; my = e.clientY / h; };
    size();
    window.addEventListener('resize', size);
    if (reduced()) { draw(0); return () => window.removeEventListener('resize', size); }
    window.addEventListener('pointermove', move, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', size); window.removeEventListener('pointermove', move); };
  }, []);
  return (
    <>
      <canvas ref={ref} aria-hidden="true" className="login-cv" />
      <div aria-hidden="true" className="login-tape"><div>{Array(2).fill('Properties · Units · Tenants · Rent ledger · Payments · Renewals ·').map((s, i) => <span key={i}>{s}</span>)}</div></div>
    </>
  );
}

/** Types the subtitle in and out. The accessible text is always the plain sentence. */
export function Typewriter({ base }: { base: string }) {
  const [text, setText] = useState(base);
  useEffect(() => {
    if (reduced()) return;
    const words = [base, 'Properties · Units · Tenants', 'Rent ledger · Payments · Renewals', base];
    let wi = 0, ci = 0, del = false, timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const word = words[wi];
      setText(word.slice(0, ci));
      if (!del) {
        if (ci < word.length) { ci++; timer = setTimeout(step, 55); return; }
        del = true; timer = setTimeout(step, wi === 0 ? 2600 : 1500); return;
      }
      if (ci > 0) { ci--; timer = setTimeout(step, 22); return; }
      del = false; wi = (wi + 1) % words.length; timer = setTimeout(step, 300);
    };
    timer = setTimeout(step, 2600);
    return () => clearTimeout(timer);
  }, [base]);
  return (
    <span aria-label={base} className="inline-block min-h-[1.25rem]">
      <span aria-hidden="true">{text}</span>
    </span>
  );
}

/** "● SECURE 21:04:10 IST" - sits in the gap between the heading and the card. */
export function LiveStatus() {
  const [now, setNow] = useState('');
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <p aria-hidden="true" className="login-status mono"><i />Secure <b>{now} IST</b></p>
  );
}

/** Bars that fill as PIN digits are typed. Absolutely positioned, so the field does not move. */
export function PinBars({ length, total = 4 }: { length: number; total?: number }) {
  return (
    <div aria-hidden="true" className="pin-bars">
      {Array.from({ length: total }, (_, i) => <i key={i} className={i < length ? 'on' : ''} />)}
    </div>
  );
}
