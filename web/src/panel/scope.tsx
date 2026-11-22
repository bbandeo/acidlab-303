import { useEffect, useRef } from "preact/hooks";
import type { AcidSynth } from "../synth";

export function Scope({ synth, playing }: { synth: AcidSynth; playing: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const analyser = playing ? synth.scope : undefined;
    const values = analyser ? new Float32Array(analyser.fftSize) : undefined;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    function draw() {
      if (!element || !ctx) return;
      const scale = devicePixelRatio;
      const w = Math.round(element.clientWidth * scale);
      const h = Math.round(element.clientHeight * scale);
      if (element.width !== w || element.height !== h) {
        element.width = w;
        element.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = getComputedStyle(element).color;
      ctx.lineWidth = 1.5 * scale;
      ctx.globalAlpha = analyser && !reduced.matches ? 1 : 0.35;
      ctx.beginPath();
      if (analyser && values && !reduced.matches) {
        analyser.getFloatTimeDomainData(values);
        const crossing = values.findIndex((v, i) => i > 0 && i < values.length / 2 && v >= 0 && values[i - 1]! < 0);
        const start = Math.max(0, crossing);
        const count = values.length / 2;
        for (let i = 0; i < count; i++) {
          const x = i * w / (count - 1);
          const y = (0.5 - Math.max(-0.48, Math.min(0.48, values[start + i]! * 1.4))) * h;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
      }
      ctx.stroke();
    }
    const animate = () => {
      draw();
      if (analyser && !reduced.matches) frame = requestAnimationFrame(animate);
    };
    const update = () => {
      cancelAnimationFrame(frame);
      animate();
    };
    const resize = new ResizeObserver(draw);
    resize.observe(element);
    reduced.addEventListener("change", update);
    animate();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      reduced.removeEventListener("change", update);
    };
  }, [synth, playing]);

  return <canvas class="scope" ref={canvas} aria-hidden="true" />;
}
