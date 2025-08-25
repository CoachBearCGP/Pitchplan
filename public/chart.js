function drawBarChart(canvas, labels, values, opts){
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const pad = { t: 20, r: 20, b: 40, l: 40 };
  ctx.clearRect(0,0,W,H);
  // axes
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, H-pad.b);
  ctx.lineTo(W-pad.r, H-pad.b);
  ctx.stroke();
  const yMax = (opts && opts.yMax) || Math.max(3, Math.max(...values,3));
  const xLabelEvery = (opts && opts.xLabelEvery) || 1;
  const n = values.length;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  // grid & y labels
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  for (let y=0;y<=yMax;y++){
    const yPos = pad.t + plotH - (y/yMax)*plotH;
    ctx.beginPath(); ctx.moveTo(pad.l, yPos); ctx.lineTo(W-pad.r, yPos); ctx.stroke();
    ctx.fillText(String(y), pad.l-8, yPos);
  }
  // bars
  const barW = plotW / n * 0.8;
  for (let i=0;i<n;i++){
    const x = pad.l + (i+0.1) * (plotW/n);
    const h = (values[i]/yMax)*plotH;
    const y = pad.t + plotH - h;
    ctx.fillRect(x, y, barW, h);
  }
  // x labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let i=0;i<n;i+=xLabelEvery){
    const x = pad.l + (i+0.5)*(plotW/n);
    ctx.fillText(labels[i], x, H - pad.b + 6);
  }
  // title
  if (opts && opts.title){
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(opts.title, pad.l, 14);
  }
}