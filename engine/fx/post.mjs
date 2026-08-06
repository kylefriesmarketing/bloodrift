// Post chain: scene buffer → bloom → colour grade → chromatic aberration → canvas.
// Pure Canvas2D. The bright-pass uses self-multiply to crush darks (value^4), so
// only genuinely hot pixels — the rift, sparks, muzzle flash, blood highlights —
// survive into the blur.

export class Post {
  constructor(w, h) {
    this.w = w; this.h = h;
    const mk = (cw, ch) => {
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      return c;
    };
    this.bw = Math.max(1, w >> 2);
    this.bh = Math.max(1, h >> 2);
    this.bright = mk(this.bw, this.bh);
    this.bcx = this.bright.getContext('2d');
    this.blur = mk(this.bw, this.bh);
    this.blcx = this.blur.getContext('2d');
    this.tmp = mk(w, h);
    this.tcx = this.tmp.getContext('2d');
    this.hasFilter = typeof this.blcx.filter === 'string';
  }

  apply(scene, out, o = {}) {
    const { w, h } = this;
    const bloom = o.bloom === undefined ? 0.85 : o.bloom;
    const ab = o.aberration || 0;

    // ---- base image (with optional RGB split)
    out.globalCompositeOperation = 'source-over';
    out.globalAlpha = 1;
    if (ab > 0.4) {
      out.fillStyle = '#000';
      out.fillRect(0, 0, w, h);
      out.globalCompositeOperation = 'lighter';
      this.channel(scene, '#ff0000');
      out.drawImage(this.tmp, ab, 0);
      this.channel(scene, '#00ffff');
      out.drawImage(this.tmp, -ab, 0);
      out.globalCompositeOperation = 'source-over';
    } else {
      out.drawImage(scene, 0, 0);
    }

    // ---- bloom
    if (bloom > 0.01) {
      const b = this.bcx;
      b.globalCompositeOperation = 'source-over';
      b.globalAlpha = 1;
      b.clearRect(0, 0, this.bw, this.bh);
      b.drawImage(scene, 0, 0, this.bw, this.bh);
      // crush: value² then value⁴ — leaves only the hot pixels
      b.globalCompositeOperation = 'multiply';
      b.drawImage(this.bright, 0, 0);
      b.drawImage(this.bright, 0, 0);
      b.globalCompositeOperation = 'source-over';

      const bl = this.blcx;
      bl.globalCompositeOperation = 'source-over';
      bl.clearRect(0, 0, this.bw, this.bh);
      if (this.hasFilter) bl.filter = 'blur(5px)';
      bl.drawImage(this.bright, 0, 0);
      bl.filter = 'none';

      out.globalCompositeOperation = 'lighter';
      out.globalAlpha = bloom;
      out.drawImage(this.blur, 0, 0, w, h);
      // a second, wider pass for the soft halo
      out.globalAlpha = bloom * 0.3;
      out.drawImage(this.blur, -w * 0.012, -h * 0.012, w * 1.024, h * 1.024);
      out.globalAlpha = 1;
      out.globalCompositeOperation = 'source-over';
    }

    // ---- grade: cool the shadows, warm the floor, lift contrast a touch
    if (!this.grade) {
      const g = out.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(38,44,84,0.16)');
      g.addColorStop(0.55, 'rgba(70,50,60,0.05)');
      g.addColorStop(1, 'rgba(120,50,40,0.12)');
      this.grade = g;
    }
    out.globalCompositeOperation = 'soft-light';
    out.fillStyle = this.grade;
    out.fillRect(0, 0, w, h);
    out.globalCompositeOperation = 'source-over';
  }

  // isolate a colour channel of `src` into this.tmp (multiply against a pure primary)
  channel(src, col) {
    const t = this.tcx;
    t.globalCompositeOperation = 'source-over';
    t.globalAlpha = 1;
    t.clearRect(0, 0, this.w, this.h);
    t.drawImage(src, 0, 0);
    t.globalCompositeOperation = 'multiply';
    t.fillStyle = col;
    t.fillRect(0, 0, this.w, this.h);
    t.globalCompositeOperation = 'source-over';
  }
}
