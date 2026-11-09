/* Canvas charts — Home line, score ring, coin candles */
(function (global) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fit(canvas, cssH) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 390;
    const h = cssH || canvas.clientHeight || 200;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function drawHomeLine(canvas, points, marks) {
    const { ctx, w, h } = fit(canvas, 200);
    ctx.clearRect(0, 0, w, h);
    if (!points || points.length < 1) return false;
    const vals = points.map(p => +p.value);
    let min = Math.min(...vals), max = Math.max(...vals);
    // Flat / near-flat series: pad so we draw a horizontal line, not a spiked triangle
    // from tiny float noise or a 0-range scale.
    const span = max - min;
    const padY = Math.max(Math.abs(min) * 0.02, 1); // >= $1 or 2% of level
    if (!(span > padY * 0.01)) { // ~0 relative range
      const mid = (min + max) / 2;
      min = mid - padY;
      max = mid + padY;
    }
    const pad = 12;
    const start = vals[0];
    const xAt = i => pad + (w - pad * 2) * (points.length === 1 ? 0.5 : i / (points.length - 1));
    const yAt = v => pad + (h - pad * 2) * (1 - (v - min) / (max - min));

    // dashed start line
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(235,235,245,0.3)';
    ctx.beginPath();
    ctx.moveTo(pad, yAt(start));
    ctx.lineTo(w - pad, yAt(start));
    ctx.stroke();
    ctx.setLineDash([]);

    // gradient fill
    const g = ctx.createLinearGradient(0, pad, 0, h - pad);
    g.addColorStop(0, 'rgba(0,211,90,0.28)');
    g.addColorStop(1, 'rgba(0,211,90,0)');
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xAt(i), y = yAt(+p.value);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(xAt(points.length - 1), h - pad);
    ctx.lineTo(xAt(0), h - pad);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();

    // line
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xAt(i), y = yAt(+p.value);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#00d35a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // marks (stack upward if overlap)
    if (marks && marks.length) {
      const used = [];
      marks.forEach(m => {
        // map mark ts to nearest point
        let idx = 0, best = Infinity;
        points.forEach((p, i) => {
          const d = Math.abs(Date.parse(p.ts) - Date.parse(m.ts));
          if (d < best) { best = d; idx = i; }
        });
        let x = xAt(idx), y = yAt(+points[idx].value) - 14;
        used.forEach(uy => { if (Math.abs(uy - y) < 14) y -= 14; });
        used.push(y);
        let color = '#0a84ff', label = m.title || m.kind;
        if (m.kind === 'sold') color = '#00d35a';
        if (m.kind === 'stopped') color = '#ff453a';
        ctx.fillStyle = color;
        ctx.font = '11px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.globalAlpha = reduce ? 1 : 0.95;
        ctx.fillText(String(label).slice(0, 18), x, y);
        ctx.beginPath(); ctx.arc(x, yAt(+points[idx].value), 3, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      });
    }
    return true;
  }

  function drawScoreRing(canvas, score) {
    const { ctx, w, h } = fit(canvas, 88);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 6;
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#2c2c2e';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    const pct = Math.max(0, Math.min(100, score || 0)) / 100;
    ctx.strokeStyle = score >= 70 ? '#00d35a' : '#ffd60a';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 22px -apple-system, "SF Pro Display", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(score ?? '—'), cx, cy);
  }

  function drawCandles(canvas, candles) {
    const { ctx, w, h } = fit(canvas, 180);
    ctx.clearRect(0, 0, w, h);
    if (!candles || candles.length < 2) return false;
    // synthesize OHLC from sequential prices
    const bars = [];
    for (let i = 1; i < candles.length; i++) {
      const o = +candles[i - 1].price, c = +candles[i].price;
      bars.push({ o, c, h: Math.max(o, c), l: Math.min(o, c), v: candles[i].volume_m5 });
    }
    const highs = bars.map(b => b.h), lows = bars.map(b => b.l);
    let min = Math.min(...lows), max = Math.max(...highs);
    if (min === max) { min -= 1e-12; max += 1e-12; }
    const pad = 8, chartH = h * 0.72;
    const bw = Math.max(2, (w - pad * 2) / bars.length - 1);
    bars.forEach((b, i) => {
      const x = pad + i * ((w - pad * 2) / bars.length) + bw / 2;
      const yH = pad + chartH * (1 - (b.h - min) / (max - min));
      const yL = pad + chartH * (1 - (b.l - min) / (max - min));
      const yO = pad + chartH * (1 - (b.o - min) / (max - min));
      const yC = pad + chartH * (1 - (b.c - min) / (max - min));
      const up = b.c >= b.o;
      ctx.strokeStyle = up ? '#00d35a' : '#ff453a';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();
      const top = Math.min(yO, yC), bh = Math.max(1, Math.abs(yC - yO));
      ctx.fillRect(x - bw / 2, top, bw, bh);
    });
    return true;
  }

  global.DeskCharts = { drawHomeLine, drawScoreRing, drawCandles };
})(window);
