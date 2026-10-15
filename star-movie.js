// star-movie.js – turns the data of a SeBa single-star run into a movie.
// The movie is drawn live on a <canvas> from the simulation data, so every new run gives a new movie.
//
//  * size  : stellar radius on a logarithmic scale (same scale for every run)
//  * colour: from the effective temperature (red - orange - yellow - white - blue)
//  * time  : logarithmic, but slowing down when the star changes a lot, so that the
//            short, dramatic phases (giant, white dwarf, supernova) get screen time

const TAU = Math.PI * 2;
const R_SUN_KM = 695700;

// log10 of the radius (in solar radii) that is mapped onto the on-screen size range
export const LOG_R_LO = -2.3; // ~0.005 R☉: white dwarf sized and smaller
export const LOG_R_HI = 3.3; //  ~2000 R☉: the largest red giants

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, f) => a + (b - a) * f;
const mix = (a, b, f) => a.map((v, i) => lerp(v, b[i], f));
const css = (c, a = 1) =>
    `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

// SeBa stellar types (see the "type-N" texts in the language files)
const isWD = (t) => t === 12 || t === 13 || t === 14;
const isCompact = (t) => isWD(t) || t === 18 || t === 19 || t === 20;
const isGiant = (t) => t >= 5 && t <= 11;

// ---------------------------------------------------------------- colour
// Approximate colours of stars (based on blackbody colours, a little more saturated
// than reality so that the differences are easy to see)
const RAMP = [
    [2300, [255, 85, 40]],
    [3000, [255, 120, 50]],
    [3500, [255, 150, 70]],
    [4000, [255, 175, 95]],
    [4500, [255, 195, 125]],
    [5000, [255, 212, 150]],
    [5800, [255, 236, 180]],
    [6500, [255, 247, 225]],
    [7500, [240, 243, 255]],
    [10000, [205, 222, 255]],
    [15000, [175, 200, 255]],
    [25000, [150, 180, 255]],
    [40000, [130, 165, 255]],
];

export function starColor(T) {
    const logT = Math.log10(clamp(T, RAMP[0][0], RAMP[RAMP.length - 1][0]));
    for (let i = 1; i < RAMP.length; i++) {
        const [t1, c1] = RAMP[i];
        if (T <= t1 || i === RAMP.length - 1) {
            const [t0, c0] = RAMP[i - 1];
            const f = clamp((logT - Math.log10(t0)) / (Math.log10(t1) - Math.log10(t0)), 0, 1);
            return mix(c0, c1, f);
        }
    }
    return RAMP[0][1];
}

// ---------------------------------------------------------------- time line
// Turns the data rows into a time line: every data point gets a position `p` (0 - 1) in the movie.
// The distance between two points grows with the log-time step and, more strongly, with how much
// the radius and temperature change; that is what makes the movie slow down when something happens.
export function buildTimeline(rows) {
    const { time, radius, teff, mass, type } = rows;
    const pts = [];
    let tEnd = 0;
    for (let i = 0; i < time.length; i++) {
        const t = time[i];
        const R = radius[i];
        const T = teff[i];
        if (!Number.isFinite(t) || !Number.isFinite(R) || !Number.isFinite(T) || T <= 0) {
            continue;
        }
        pts.push({
            t,
            R: Math.max(R, 1e-9),
            T,
            m: mass ? mass[i] : NaN,
            ty: type ? Math.round(type[i]) : 3,
            i, // row in the original data
        });
        tEnd = Math.max(tEnd, t);
    }
    if (!pts.length) {
        return null;
    }
    const tFloor = Math.max(tEnd * 1e-5, 1e-4); // log time needs a start above zero
    for (const q of pts) {
        q.lt = Math.log10(Math.max(q.t, tFloor));
        q.lr = clamp(Math.log10(q.R), LOG_R_LO, LOG_R_HI);
        q.lT = Math.log10(clamp(q.T, 500, 1e8));
    }
    // A supernova needs some screen time afterwards (for the remnant): find it first
    let snIdx = -1;
    for (let k = 1; k < pts.length; k++) {
        if (!isCompact(pts[k - 1].ty) && (pts[k].ty === 18 || pts[k].ty === 19)) {
            snIdx = k;
            break;
        }
    }
    if (snIdx === pts.length - 1) {
        pts.push({ ...pts[snIdx] }); // the run ends at the explosion: add a moment to look at the remnant
    }

    // How much movie time every step of the data gets:
    //  - a good share for the long main sequence (log time),
    //  - most of it for the radius GROWING (sub giant, giant, supergiant branches),
    //  - little for the radius shrinking and for the collapse into a compact object,
    //  - hardly any for the long, quiet time after the star has died
    const weights = [];
    let total = 0;
    let msTotal = 0;
    for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1];
        const b = pts[k];
        const dR = b.lr - a.lr;
        let w =
            0.9 * Math.max(0, b.lt - a.lt) +
            1.6 * Math.max(0, dR) +
            0.25 * Math.max(0, -dR) +
            0.5 * Math.abs(b.lT - a.lT) +
            (a.ty !== b.ty ? 0.1 : 0);
        if (isCompact(b.ty) && !isCompact(a.ty)) {
            w = Math.min(w, 0.6);
        }
        if (isCompact(a.ty)) {
            w *= 0.15;
        }
        w = Math.max(w, 1e-3);
        weights.push(w);
        total += w;
        if (a.ty === 3) {
            msTotal += w;
        }
    }
    // the main sequence always gets at least 28% of the movie
    if (msTotal > 0 && msTotal / total < 0.28) {
        const f = ((0.28 / 0.72) * (total - msTotal)) / msTotal;
        for (let k = 1; k < pts.length; k++) {
            if (pts[k - 1].ty === 3) {
                weights[k - 1] *= f;
            }
        }
    }
    // at least 14% of the movie after a supernova
    if (snIdx > 0) {
        let post = 0;
        let all = 0;
        weights.forEach((w, j) => {
            all += w;
            if (j >= snIdx) {
                post += w;
            }
        });
        if (post / all < 0.14) {
            weights[snIdx] += (0.14 * all - post) / 0.86;
        }
    }
    const cum = [0];
    for (let k = 1; k < pts.length; k++) {
        cum.push(cum[k - 1] + weights[k - 1]);
    }
    const sum = cum[cum.length - 1] || 1;
    const p = cum.map((x) => x / sum);

    // Moments that deserve a special effect
    const events = [];
    for (let k = 1; k < pts.length; k++) {
        const prev = pts[k - 1].ty;
        const cur = pts[k].ty;
        if (!isCompact(prev) && (cur === 18 || cur === 19)) {
            events.push({ kind: "supernova", p: p[k], t: pts[k].t });
        } else if (isGiant(prev) && isWD(cur)) {
            events.push({ kind: "nebula", p: p[k], t: pts[k].t });
        }
    }
    // Time axis (Myr) that fits this star: from 0 to the moment it dies (or the end of the run)
    const dead = pts.find((q) => isCompact(q.ty));
    const axis = niceAxis(dead && dead.t > 0 ? dead.t : tEnd);
    return { pts, p, tFloor, events, axis };
}

// A "nice" ruler: big ticks at 1, 2, 2.5 or 5 times a power of ten, at most 8 of them
function niceAxis(tMax) {
    if (!(tMax > 0)) {
        return { max: 1, step: 0.2, n: 5 };
    }
    const e0 = Math.floor(Math.log10(tMax)) - 1;
    for (let e = e0; e <= e0 + 2; e++) {
        for (const m of [1, 2, 2.5, 5]) {
            const step = m * 10 ** e;
            const n = Math.ceil(tMax / step - 1e-9);
            if (n <= 8) {
                return { max: n * step, step, n };
            }
        }
    }
    return { max: tMax, step: tMax / 5, n: 5 };
}

// The state of the star at position `pos` (0 - 1) of the movie
export function stateAt(tl, pos) {
    const { pts, p, tFloor } = tl;
    const x = clamp(pos, 0, 1);
    const last = pts.length - 1;
    let lo = 0;
    let hi = last;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (p[mid] <= x) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    const a = pts[lo];
    if (lo >= last) {
        return { t: a.t, R: 10 ** a.lr, T: a.T, m: a.m, type: a.ty, p: x, i0: a.i, i1: a.i, f: 0 };
    }
    const b = pts[lo + 1];
    const f = (x - p[lo]) / (p[lo + 1] - p[lo] || 1);
    const lt = lerp(a.lt, b.lt, f);
    return {
        t: f === 0 ? a.t : Math.max(10 ** lt, tFloor),
        R: 10 ** lerp(a.lr, b.lr, f),
        T: 10 ** lerp(a.lT, b.lT, f),
        m: lerp(a.m, b.m, f),
        type: a.ty,
        p: x,
        i0: a.i, // the two data rows the star is between, and how far (0 - 1)
        i1: b.i,
        f,
    };
}

// ---------------------------------------------------------------- text
export function formatTime(tMyr, lang, t) {
    const yr = tMyr * 1e6;
    let v;
    let unit;
    if (yr < 1e3) {
        v = yr;
        unit = "movie-unit-yr";
    } else if (yr < 1e6) {
        v = yr / 1e3;
        unit = "movie-unit-kyr";
    } else if (yr < 1e9) {
        v = yr / 1e6;
        unit = "movie-unit-myr";
    } else {
        v = yr / 1e9;
        unit = "movie-unit-gyr";
    }
    const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    return `${v.toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${t(unit)}`;
}

function formatRadius(R, lang, t) {
    if (R < 0.001) {
        const km = R * R_SUN_KM;
        return `${km.toLocaleString(lang, { maximumFractionDigits: km < 100 ? 1 : 0 })} km`;
    }
    const digits = R >= 100 ? 0 : R >= 10 ? 1 : R >= 1 ? 2 : 3;
    return `${R.toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${t("unit-radius")}`;
}

// ---------------------------------------------------------------- textures
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// A seamless noise tile: white pixels whose transparency carries the noise
function makeNoise(seed) {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    const rnd = mulberry32(seed);
    const octaves = [
        [8, 0.5],
        [16, 0.3],
        [32, 0.2],
    ].map(([g, amp]) => ({ g, amp, grid: Array.from({ length: g * g }, rnd) }));
    const smooth = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let v = 0;
            for (const { g, amp, grid } of octaves) {
                const fx = (x / size) * g;
                const fy = (y / size) * g;
                const ix = Math.floor(fx);
                const iy = Math.floor(fy);
                const sx = smooth(fx - ix);
                const sy = smooth(fy - iy);
                const at = (i, j) => grid[(j % g) * g + (i % g)];
                v +=
                    amp *
                    lerp(
                        lerp(at(ix, iy), at(ix + 1, iy), sx),
                        lerp(at(ix, iy + 1), at(ix + 1, iy + 1), sx),
                        sy,
                    );
            }
            const n = clamp((v - 0.35) * 2.0, 0, 1);
            const i = (y * size + x) * 4;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
            img.data[i + 3] = Math.round(n * n * 255);
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

// Thin glowing strands for the supernova remnant (orange and red, a few green and blue)
function makeFilaments(n) {
    const rnd = mulberry32(4242);
    const palette = [
        [255, 110, 60],
        [255, 160, 70],
        [255, 90, 100],
        [255, 200, 110],
        [110, 230, 170],
        [130, 190, 255],
    ];
    return Array.from({ length: n }, () => ({
        ang: rnd() * TAU,
        rho: 0.3 + 0.7 * Math.sqrt(rnd()),
        len: 0.05 + rnd() * 0.22,
        bend: (rnd() - 0.5) * 0.9,
        w: 0.6 + rnd() * 1.6,
        a: 0.25 + rnd() * 0.55,
        c: palette[Math.floor(rnd() ** 1.3 * palette.length)],
        ph: rnd() * TAU,
    }));
}

function makeBackground(n) {
    const rnd = mulberry32(1234);
    const tints = ["255,255,255", "255,255,255", "205,222,255", "255,238,214"];
    return Array.from({ length: n }, () => ({
        x: rnd(),
        y: rnd(),
        r: 0.4 + rnd() ** 3 * 1.5,
        a: 0.3 + rnd() * 0.7,
        speed: 0.5 + rnd() * 2,
        phase: rnd() * TAU,
        tint: tints[Math.floor(rnd() * tints.length)],
    }));
}

// ---------------------------------------------------------------- the movie
export class StarMovie {
    constructor(opts) {
        this.canvas = opts.canvas;
        this.t = opts.t || ((key) => key);
        this.playBtn = opts.playButton || null;
        this.replayBtn = opts.replayButton || null;
        this.slider = opts.slider || null;
        this.speedSelect = opts.speedSelect || null;
        this.downloadBtn = opts.downloadButton || null;
        this.onState = opts.onState || null; // told about the state of the star at every frame
        this.recording = false;
        this.recCtx = null;

        this.ctx = this.canvas.getContext("2d");
        this.reduced = !!(
            window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );
        this.duration = 26; // seconds for the whole movie at normal speed
        this.speed = 1;
        this.p = 0;
        this.playing = false;
        this.timeline = null;
        this.sec = 0; // clock for the idle animation (twinkling, churning surface)
        this.W = 960;
        this.H = 540;
        this.dpr = 1;
        this.rafId = null;
        this.lastNow = 0;

        this.bgStars = makeBackground(260);
        this.filaments = makeFilaments(220);
        this.noise = [makeNoise(7), makeNoise(21), makeNoise(99)];
        this.crab = null; // the photo of the Crab Nebula, once loaded (otherwise the drawn remnant is used)
        this._loadCrab(opts.crabImage || "crab-nebula.jpg", opts.onCrabLoaded);
        this.helix = null; // the photo of the Helix Nebula (planetary nebula, binary movie); otherwise a drawn shell
        this._loadPhoto(opts.helixImage || "helix-nebula.jpg", (c) => {
            this.helix = c;
            if (opts.onHelixLoaded) {
                opts.onHelixLoaded();
            }
        });
        this.tmp = document.createElement("canvas");
        this.tmp.width = this.tmp.height = 256;
        this.tctx = this.tmp.getContext("2d");

        if (this.downloadBtn && !this._canRecord()) {
            this.downloadBtn.hidden = true; // this browser cannot record a canvas
        }
        this._bind();
        this.resize();
        this.refreshLabels();
        this._startLoop();
    }

    // ----- public
    load(rows) {
        this.timeline = buildTimeline(rows);
        if (this.downloadBtn) {
            this.downloadBtn.disabled = !this.timeline;
        }
        this.p = 0;
        this._syncSlider();
        if (this.timeline && !this.reduced) {
            this.play();
        } else {
            this.pause();
        }
        this.render();
    }

    play() {
        if (!this.timeline) {
            return;
        }
        if (this.p >= 1) {
            this.p = 0;
        }
        this.playing = true;
        this.refreshLabels();
    }

    pause() {
        this.playing = false;
        this.refreshLabels();
    }

    refreshLabels() {
        if (this.playBtn) {
            this.playBtn.textContent = this.t(this.playing ? "movie-pause" : "movie-play");
        }
        if (this.replayBtn) {
            this.replayBtn.textContent = this.t("movie-replay");
        }
        if (this.downloadBtn && !this.recording) {
            this.downloadBtn.textContent = this.t("movie-download");
        }
        this.canvas.setAttribute("aria-label", this.t("movie-aria"));
        this.render();
    }

    resize() {
        const w = this.canvas.clientWidth || 960;
        const h = this.canvas.clientHeight || Math.round((w * 9) / 16);
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = w;
        this.H = h;
        this.canvas.width = Math.round(w * this.dpr);
        this.canvas.height = Math.round(h * this.dpr);
        this.render();
    }

    // Loads the photo of the Crab Nebula (crab-nebula.jpg next to the page). If it is not there,
    // nothing happens and the drawn remnant is used instead.
    _loadCrab(src, onLoaded) {
        this._loadPhoto(src, (c) => {
            this.crab = c;
            if (onLoaded) {
                onLoaded();
            }
        });
    }

    // Loads a photo, gives it a soft oval edge and hands the result to done(canvas)
    _loadPhoto(src, done) {
        if (typeof Image === "undefined") {
            return;
        }
        const img = new Image();
        img.onload = () => {
            const k = Math.min(1, 1100 / img.naturalWidth);
            const w = Math.round(img.naturalWidth * k);
            const h = Math.round(img.naturalHeight * k);
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const g = c.getContext("2d");
            g.drawImage(img, 0, 0, w, h);
            // a soft oval edge, so that no square outline of the photo shows
            g.globalCompositeOperation = "destination-in";
            g.save();
            g.translate(w / 2, h / 2);
            g.scale(w / 2, h / 2);
            const mask = g.createRadialGradient(0, 0, 0, 0, 0, 1);
            mask.addColorStop(0, "rgba(0,0,0,1)");
            mask.addColorStop(0.78, "rgba(0,0,0,1)");
            mask.addColorStop(1, "rgba(0,0,0,0)");
            g.fillStyle = mask;
            g.beginPath();
            g.arc(0, 0, 1, 0, TAU);
            g.fill();
            g.restore();
            done(c);
        };
        img.onerror = () => {};
        img.src = src;
    }

    // ----- download: record the movie from start to end and save it as a video file
    _canRecord() {
        return typeof MediaRecorder !== "undefined" && typeof this.canvas.captureStream === "function";
    }

    async record() {
        if (this.recording || !this.timeline || !this._canRecord()) {
            return;
        }
        const types = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
        const mime = types.find((type) => MediaRecorder.isTypeSupported(type));
        // a separate canvas of fixed size, so that the file has the same size on every screen
        const rec = document.createElement("canvas");
        rec.width = 1280;
        rec.height = 720;
        this.recCtx = rec.getContext("2d");
        const stream = rec.captureStream(30);
        let recorder;
        try {
            recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6000000 } : undefined);
        } catch (error) {
            recorder = new MediaRecorder(stream);
        }
        const chunks = [];
        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size) {
                chunks.push(e.data);
            }
        };
        const stopped = new Promise((resolve) => {
            recorder.onstop = resolve;
        });

        this.recording = true;
        this.recHold = 0;
        this.p = 0;
        this.playing = true;
        for (const el of [this.playBtn, this.replayBtn, this.slider, this.speedSelect]) {
            if (el) {
                el.disabled = true;
            }
        }
        if (this.downloadBtn) {
            this.downloadBtn.disabled = true;
        }
        this._recStop = () => recorder.stop();
        this._startLoop();
        this._renderTo(this.recCtx, 1280, 720, 1, true);
        recorder.start(250);
        await stopped;

        stream.getTracks().forEach((track) => track.stop());
        const type = recorder.mimeType || mime || "video/webm";
        const blob = new Blob(chunks, { type });
        const lang = document.documentElement.lang || "en";
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${lang === "nl" ? "sterrenstrijd-film" : "star-workshop-movie"}.${type.includes("mp4") ? "mp4" : "webm"}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);

        this.recording = false;
        this.recCtx = null;
        this.playing = false;
        this.p = 1;
        for (const el of [this.playBtn, this.replayBtn, this.slider, this.speedSelect]) {
            if (el) {
                el.disabled = false;
            }
        }
        if (this.downloadBtn) {
            this.downloadBtn.disabled = false;
        }
        this._syncSlider();
        this.refreshLabels();
    }

    // One step of the recording: the movie runs at normal speed, the last frame stays for 1.5 s
    _recTick(dt) {
        if (this.p < 1) {
            this.p = Math.min(1, this.p + dt / this.duration);
        } else {
            this.recHold += dt;
            if (this.recHold >= 1.5 && this._recStop) {
                const stop = this._recStop;
                this._recStop = null;
                stop();
            }
        }
        this._syncSlider();
        if (this.downloadBtn) {
            const label = `${this.t("movie-recording")} ${Math.ceil((1 - this.p) * this.duration)} s`;
            if (this.downloadBtn.textContent !== label) {
                this.downloadBtn.textContent = label;
            }
        }
        if (this.recCtx) {
            this._renderTo(this.recCtx, 1280, 720, 1, true);
        }
    }

    // Draws one frame on another canvas (with its own size)
    _renderTo(ctx, W, H, dpr, forRecording = false) {
        const saved = { ctx: this.ctx, W: this.W, H: this.H, dpr: this.dpr };
        this.ctx = ctx;
        this.W = W;
        this.H = H;
        this.dpr = dpr;
        this._forRecording = forRecording;
        try {
            this.render();
        } finally {
            this._forRecording = false;
            Object.assign(this, saved);
        }
    }

    // ----- plumbing
    _bind() {
        if (this.playBtn) {
            this.playBtn.addEventListener("click", () => {
                if (this.playing) {
                    this.pause();
                } else {
                    this.play();
                }
            });
        }
        if (this.replayBtn) {
            this.replayBtn.addEventListener("click", () => {
                if (!this.timeline) {
                    return;
                }
                this.p = 0;
                this.play();
            });
        }
        if (this.downloadBtn) {
            this.downloadBtn.addEventListener("click", () => this.record());
        }
        if (this.slider) {
            this.slider.addEventListener("input", () => {
                this.p = clamp(Number(this.slider.value) / 1000, 0, 1);
                this.pause();
            });
        }
        if (this.speedSelect) {
            this.speedSelect.addEventListener("change", () => {
                this.speed = parseFloat(this.speedSelect.value) || 1;
            });
        }
        if (typeof ResizeObserver !== "undefined") {
            new ResizeObserver(() => this.resize()).observe(this.canvas);
        } else {
            window.addEventListener("resize", () => this.resize());
        }
        if (typeof IntersectionObserver !== "undefined") {
            // only animate while the movie is on screen
            new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    this._startLoop();
                } else if (!this.recording) {
                    this._stopLoop();
                }
            }).observe(this.canvas);
        }
    }

    _syncSlider() {
        if (this.slider) {
            this.slider.value = String(Math.round(this.p * 1000));
        }
    }

    _startLoop() {
        if (this.rafId !== null) {
            return;
        }
        this.lastNow = performance.now();
        const tick = (now) => {
            const dt = Math.min(0.1, (now - this.lastNow) / 1000);
            this.lastNow = now;
            if (this.recording) {
                this._recTick(dt);
            } else if (this.playing && this.timeline) {
                this.p += (dt * this.speed) / this.duration;
                if (this.p >= 1) {
                    this.p = 1;
                    this.playing = false;
                    this.refreshLabels();
                }
                this._syncSlider();
            }
            if (!this.reduced) {
                this.sec += dt;
            }
            if (!this.reduced || this.playing) {
                this.render();
            }
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    }

    _stopLoop() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    // ----- drawing
    _radiusPx(R) {
        const minPx = 0.012 * this.H;
        const maxPx = 0.46 * this.H;
        const f = clamp((Math.log10(Math.max(R, 1e-9)) - LOG_R_LO) / (LOG_R_HI - LOG_R_LO), 0, 1);
        return minPx + f * (maxPx - minPx);
    }

    render() {
        const { ctx, W, H } = this;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        this._drawBackground();

        const lang = document.documentElement.lang || "en";
        if (!this.timeline) {
            ctx.fillStyle = "rgba(232,236,245,0.75)";
            ctx.font = `${Math.max(13, W / 50)}px "Instrument Sans", system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText(this.t("movie-empty"), W / 2, H / 2);
            ctx.textAlign = "left";
            return;
        }

        const s = stateAt(this.timeline, this.p);
        if (this.onState && !this._forRecording) {
            this.onState(s);
        }
        const cx = W / 2;
        const cy = H / 2;
        const r = this._radiusPx(s.R);

        this._drawSunRing(cx, cy);
        this._drawEvents(cx, cy, r, false);

        if (s.type === 19) {
            this._drawBlackHole(cx, cy);
        } else if (s.type === 18) {
            this._drawNeutronStar(cx, cy, s.T);
        } else if (isWD(s.type)) {
            this._drawWhiteDwarf(cx, cy, Math.max(r, 0.02 * H), s.T);
        } else if (s.type !== 20) {
            this._drawStar(cx, cy, r, s.T, s.type);
        }

        this._drawEvents(cx, cy, r, true);
        this._drawHUD(s, lang);
        if (this._forRecording) {
            this._drawWatermark();
        }
    }

    // Only in recordings, so that the video still says where it comes from
    _drawWatermark() {
        const { ctx, W, H } = this;
        const fs = clamp(W / 70, 10, 14);
        ctx.save();
        ctx.textAlign = "right";
        ctx.font = `${fs}px "Instrument Sans", system-ui, sans-serif`;
        ctx.fillStyle = "rgba(232,236,245,0.6)";
        const x = W - W * 0.02;
        let y = H - W * 0.015;
        if (this.crab) {
            ctx.fillText(this.t("movie-credit-short"), x, y);
            y -= fs * 1.4;
        }
        if (this instanceof BinaryMovie && this.helix && this.timeline && this.timeline.events && this.timeline.events.some((q) => q.kind === "nebula")) {
            ctx.fillText(this.t("movie-credit-helix-short"), x, y);
            y -= fs * 1.4;
        }
        ctx.fillText(this.t("seba-main-title"), x, y);
        ctx.restore();
    }

    _drawBackground() {
        const { ctx, W, H, sec } = this;
        for (const s of this.bgStars) {
            const tw = this.reduced ? 1 : 0.65 + 0.35 * Math.sin(sec * s.speed + s.phase);
            ctx.fillStyle = `rgba(${s.tint},${(s.a * tw).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(s.x * W, s.y * H, s.r, 0, TAU);
            ctx.fill();
        }
    }

    // Dashed ring with the size of the Sun, as a point of reference
    _drawSunRing(cx, cy) {
        const { ctx } = this;
        const r1 = this._radiusPx(1);
        ctx.save();
        ctx.setLineDash([4, 7]);
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r1, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = `${Math.max(10, this.W / 80)}px "Instrument Sans", system-ui, sans-serif`;
        ctx.fillText(this.t("sun"), cx + r1 * 0.72 + 6, cy - r1 * 0.72 - 4);
        ctx.restore();
    }

    _drawStar(cx, cy, r0, T, type) {
        const { ctx, sec } = this;
        const pulsing = type === 8 || type === 11;
        const r = pulsing ? r0 * (1 + 0.012 * Math.sin(sec * 1.3)) : r0;
        const c = starColor(T);

        // glow
        const glowR = r * (T > 9000 ? 2.8 : T > 5000 ? 2.2 : 1.9) + 8;
        const glow = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, glowR);
        glow.addColorStop(0, css(c, 0.5));
        glow.addColorStop(0.4, css(c, 0.18));
        glow.addColorStop(1, css(c, 0));
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, TAU);
        ctx.fill();
        ctx.restore();

        // the disc: base colour, then a hot and a cool patchwork, then darker edges
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.clip();
        const base = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.05, cx, cy, r * 1.02);
        base.addColorStop(0, css(mix(c, [255, 255, 255], 0.35)));
        base.addColorStop(0.65, css(c));
        base.addColorStop(1, css(mix(c, [0, 0, 0], 0.45)));
        ctx.fillStyle = base;
        ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);

        // bigger cells for giants, finer for hot stars
        const coarse =
            type === 8 || type === 9 || type === 11
                ? 2.6
                : type >= 5 && type <= 7
                  ? 1.9
                  : T > 10000
                    ? 0.8
                    : 1.1;
        const tilePx = Math.min(2 * r * coarse, 640); // not too coarse on very big stars
        const off = { x: sec * r * 0.03, y: sec * r * 0.015 };
        const rot = sec * 0.02;
        this._texture(0, starColor(T * 1.35), 0.3, T > 9000 ? "screen" : "lighter", tilePx, off, rot, cx, cy, r);
        this._texture(
            1,
            mix(starColor(T * 0.7), [0, 0, 0], 0.35),
            0.55,
            "multiply",
            tilePx * 0.8,
            { x: -off.x * 0.7, y: off.y * 1.4 },
            -rot,
            cx,
            cy,
            r,
        );
        this._texture(2, [0, 0, 0], 0.22, "multiply", tilePx * 0.45, off, rot * 2, cx, cy, r);

        const limb = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
        limb.addColorStop(0, "rgba(0,0,0,0)");
        limb.addColorStop(1, "rgba(0,0,0,0.4)");
        ctx.fillStyle = limb;
        ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
        ctx.restore();
    }

    // Draws a tinted, repeating noise layer over the star (inside the clip of the disc)
    _texture(idx, rgb, alpha, composite, tilePx, off, rot, cx, cy, r) {
        const { ctx, tctx } = this;
        tctx.globalCompositeOperation = "source-over";
        tctx.clearRect(0, 0, 256, 256);
        tctx.drawImage(this.noise[idx], 0, 0);
        tctx.globalCompositeOperation = "source-in";
        tctx.fillStyle = css(rgb);
        tctx.fillRect(0, 0, 256, 256);
        tctx.globalCompositeOperation = "source-over";
        const pattern = ctx.createPattern(this.tmp, "repeat");
        const k = Math.max(tilePx, 8) / 256;
        ctx.save();
        ctx.globalCompositeOperation = composite;
        ctx.globalAlpha = alpha;
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.scale(k, k);
        // the drift moves the pattern, not the painted square (that showed up as straight lines)
        if (pattern && pattern.setTransform && typeof DOMMatrix !== "undefined") {
            pattern.setTransform(new DOMMatrix().translate(off.x / k, off.y / k));
        }
        ctx.fillStyle = pattern;
        const big = (r * 1.6) / k;
        ctx.fillRect(-big, -big, 2 * big, 2 * big);
        ctx.restore();
    }

    _drawWhiteDwarf(cx, cy, r, T) {
        const { ctx } = this;
        const c = mix(starColor(T), [255, 255, 255], 0.35);
        const glowR = r * 5 + 6;
        const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, glowR);
        glow.addColorStop(0, css(c, 0.55));
        glow.addColorStop(1, css(c, 0));
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, TAU);
        ctx.fill();
        ctx.restore();
        const disc = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.05, cx, cy, r);
        disc.addColorStop(0, "rgba(255,255,255,1)");
        disc.addColorStop(1, css(c));
        ctx.fillStyle = disc;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.fill();
    }

    _drawNeutronStar(cx, cy, T, k = 1) {
        const { ctx, sec, H } = this;
        const r = Math.max(3, 0.007 * H) * k;
        const c = mix(starColor(T), [255, 255, 255], 0.5);
        const pulse = 0.75 + 0.25 * Math.sin(sec * 12);
        const glowR = r * 9;
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        glow.addColorStop(0, css(c, 0.9 * pulse));
        glow.addColorStop(1, css(c, 0));
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, TAU);
        ctx.fill();
        // two beams that sweep round, like a pulsar
        ctx.translate(cx, cy);
        ctx.rotate(sec * 5);
        const len = 0.3 * H * k;
        for (const dir of [1, -1]) {
            const beam = ctx.createLinearGradient(0, 0, dir * len, 0);
            beam.addColorStop(0, css(c, 0.6));
            beam.addColorStop(1, css(c, 0));
            ctx.fillStyle = beam;
            ctx.beginPath();
            ctx.moveTo(0, -1.5);
            ctx.lineTo(dir * len, -6);
            ctx.lineTo(dir * len, 6);
            ctx.lineTo(0, 1.5);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.fill();
    }

    _drawBlackHole(cx, cy, k = 1) {
        const { ctx, H } = this;
        const rb = Math.max(10, 0.035 * H) * k;
        // glowing disk behind and in front of the hole
        const disk = (width, color, front) => {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(-0.25);
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            if (front) {
                ctx.ellipse(0, 0, rb * 3.2, rb * 0.85, 0, 0, Math.PI);
            } else {
                ctx.ellipse(0, 0, rb * 3.2, rb * 0.85, 0, Math.PI, TAU);
            }
            ctx.stroke();
            ctx.restore();
        };
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        disk(rb * 0.55, "rgba(255,140,80,0.35)", false);
        disk(rb * 0.2, "rgba(255,210,122,0.9)", false);
        ctx.restore();
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.arc(cx, cy, rb, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,210,122,0.85)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, rb + 1, 0, TAU);
        ctx.stroke();
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        disk(rb * 0.55, "rgba(255,140,80,0.35)", true);
        disk(rb * 0.2, "rgba(255,230,170,0.95)", true);
        ctx.restore();
    }

    // The supernova remnant: the photo of the Crab Nebula if it is available, otherwise a drawn look-alike
    // (blue glow inside, a web of red-orange strands round it).
    // `u` runs from 0 (just exploded) to 1 (faded away).
    _drawRemnant(cx, cy, u, scale = 1) {
        const { ctx, H, sec } = this;
        const smooth = (x) => {
            const t = clamp(x, 0, 1);
            return t * t * (3 - 2 * t);
        };
        const env = smooth(u / 0.12) * (1 - smooth((u - 0.55) / 0.45));
        if (env <= 0.001) {
            return;
        }
        if (this.crab) {
            // the real photo: it grows from the middle and fades away (black adds nothing when added to the sky)
            const grow = 0.15 + 0.85 * (1 - (1 - u) ** 3);
            const h = H * 0.98 * grow * scale;
            const w = h * (this.crab.width / this.crab.height);
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = env * 0.95;
            ctx.drawImage(this.crab, cx - w / 2, cy - h / 2, w, h);
            ctx.restore();
            return;
        }
        const Rn = H * (0.07 + 0.4 * (1 - (1 - u) ** 3)) * scale;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.translate(cx, cy);
        ctx.rotate(0.5);

        // glow of the whole cloud (an oval, like the real thing)
        ctx.save();
        ctx.scale(1.2, 0.9);
        const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, Rn);
        haze.addColorStop(0, `rgba(170,190,255,${(0.5 * env).toFixed(3)})`);
        haze.addColorStop(0.5, `rgba(120,150,255,${(0.2 * env).toFixed(3)})`);
        haze.addColorStop(0.85, `rgba(255,140,90,${(0.1 * env).toFixed(3)})`);
        haze.addColorStop(1, "rgba(255,140,90,0)");
        ctx.fillStyle = haze;
        ctx.beginPath();
        ctx.arc(0, 0, Rn, 0, TAU);
        ctx.fill();
        ctx.restore();

        // the strands
        ctx.lineCap = "round";
        for (const f of this.filaments) {
            const tw = 0.8 + 0.2 * Math.sin(sec * 2 + f.ph);
            const x0 = Math.cos(f.ang) * f.rho * Rn * 1.2;
            const y0 = Math.sin(f.ang) * f.rho * Rn * 0.9;
            const dir = f.ang + Math.PI / 2;
            const L = f.len * Rn;
            const x1 = x0 + Math.cos(dir) * L;
            const y1 = y0 + Math.sin(dir) * L;
            const qx = (x0 + x1) / 2 + Math.cos(f.ang) * f.bend * L;
            const qy = (y0 + y1) / 2 + Math.sin(f.ang) * f.bend * L;
            ctx.strokeStyle = css(f.c, (f.a * env * tw).toFixed(3));
            ctx.lineWidth = f.w;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.quadraticCurveTo(qx, qy, x1, y1);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Supernova flash and planetary-nebula shell around the moment of the event
    _drawEvents(cx, cy, r, overlay) {
        const { ctx, W, H } = this;
        for (const ev of this.timeline.events) {
            if (ev.kind === "supernova" && !overlay) {
                const uRem = (this.p - ev.p) / 0.12;
                if (uRem >= 0 && uRem <= 1) {
                    this._drawRemnant(cx, cy, uRem);
                }
            }
            const span = ev.kind === "supernova" ? 0.06 : 0.09;
            const u = (this.p - ev.p) / span;
            if (u < 0 || u > 1) {
                continue;
            }
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            if (ev.kind === "supernova") {
                const rs = Math.max(r, 0.04 * H) + u * 0.62 * H;
                const fade = (1 - u) ** 1.5;
                if (!overlay) {
                    const ring = ctx.createRadialGradient(cx, cy, rs * 0.7, cx, cy, rs);
                    ring.addColorStop(0, "rgba(255,150,80,0)");
                    ring.addColorStop(0.85, `rgba(255,170,90,${(0.7 * fade).toFixed(3)})`);
                    ring.addColorStop(1, "rgba(255,120,60,0)");
                    ctx.fillStyle = ring;
                    ctx.fillRect(0, 0, W, H);
                } else {
                    const flash = ctx.createRadialGradient(cx, cy, 0, cx, cy, rs * 0.8);
                    flash.addColorStop(0, `rgba(255,255,255,${(0.95 * (1 - u) ** 3).toFixed(3)})`);
                    flash.addColorStop(1, "rgba(255,200,120,0)");
                    ctx.fillStyle = flash;
                    ctx.fillRect(0, 0, W, H);
                    ctx.fillStyle = `rgba(255,255,255,${(0.3 * (1 - u) ** 4).toFixed(3)})`;
                    ctx.fillRect(0, 0, W, H);
                }
            } else if (!overlay) {
                const rs = Math.max(r, 0.05 * H) + u * 0.5 * H;
                const fade = (1 - u) ** 1.3;
                const shell = ctx.createRadialGradient(cx, cy, rs * 0.75, cx, cy, rs);
                shell.addColorStop(0, "rgba(120,220,255,0)");
                shell.addColorStop(0.6, `rgba(120,220,255,${(0.45 * fade).toFixed(3)})`);
                shell.addColorStop(0.85, `rgba(255,130,210,${(0.4 * fade).toFixed(3)})`);
                shell.addColorStop(1, "rgba(255,130,210,0)");
                ctx.fillStyle = shell;
                ctx.fillRect(0, 0, W, H);
            }
            ctx.restore();
        }
    }

    // Lower left: the time, a ruler (in billions or millions of years) with a travelling dot, then the other information
    _drawHUD(s, lang) {
        const { ctx, W, H } = this;
        const fs = clamp(W / 58, 11, 16);
        const lh = fs * 1.5;
        const x = W * 0.025;
        const info = [
            [this.t("movie-radius"), formatRadius(s.R, lang, this.t)],
            [this.t("movie-temp"), `${(Math.round(s.T / 10) * 10).toLocaleString(lang)} ${this.t("unit-kelvin")}`],
        ];
        if (Number.isFinite(s.m)) {
            info.push([
                this.t("movie-mass"),
                `${s.m.toLocaleString(lang, { minimumFractionDigits: s.m < 1 ? 3 : 2, maximumFractionDigits: s.m < 1 ? 3 : 2 })} ${this.t("unit-mass")}`,
            ]);
        }
        info.push([this.t("movie-phase"), this.t(`type-${s.type}`)]);

        const barW = Math.min(W * 0.27, 260);
        const infoTop = H - W * 0.02 - info.length * lh;
        const yLine = infoTop - 8 - fs * 0.85 - fs * 0.5;
        const { max, step, n } = this.timeline.axis;
        const frac = (t) => clamp(t / max, 0, 1);

        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.85)";
        ctx.shadowBlur = 4;
        ctx.textBaseline = "alphabetic";

        // the time, a little larger than the rest
        ctx.textAlign = "left";
        ctx.fillStyle = "#f2f5fb";
        ctx.font = `600 ${fs * 1.5}px "Instrument Sans", system-ui, sans-serif`;
        ctx.fillText(formatTime(s.t, lang, this.t), x, yLine - 16);

        // the ruler: line, small and big ticks, numbers in Myr
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, yLine);
        ctx.lineTo(x + barW, yLine);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 1.5;
        for (let i = 0; i <= n; i++) {
            const xi = x + barW * ((i * step) / max);
            ctx.beginPath();
            ctx.moveTo(xi, yLine);
            ctx.lineTo(xi, yLine + 8);
            ctx.stroke();
        }
        // numbers in Gyr for long-lived stars, otherwise in Myr (or kyr for very short runs)
        const unit =
            max >= 1000
                ? { f: 1e-3, name: this.t("movie-unit-gyr") }
                : max >= 0.1
                  ? { f: 1, name: this.t("movie-unit-myr") }
                  : { f: 1e3, name: this.t("movie-unit-kyr") };
        const numFont = fs * 0.8;
        ctx.font = `${numFont}px "Instrument Sans", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(232,236,245,0.75)";
        const label = (v) => (v * unit.f).toLocaleString(lang, { maximumFractionDigits: 2, useGrouping: false });
        const widest = Math.max(...Array.from({ length: n + 1 }, (_, i) => ctx.measureText(label(i * step)).width));
        const skip = Math.max(1, Math.ceil((widest + 8) / (barW / n)));
        for (let i = 0; i <= n; i += skip) {
            ctx.fillText(label(i * step), x + barW * ((i * step) / max), yLine + 8 + numFont + 2);
        }
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(232,236,245,0.5)";
        ctx.fillText(unit.name, x + barW + 8, yLine + 4);

        // marks for a supernova (orange) or a nebula (blue)
        for (const ev of this.timeline.events) {
            ctx.fillStyle = ev.kind === "supernova" ? "#ff9d6a" : "#78dcff";
            ctx.fillRect(x + barW * frac(ev.t) - 1, yLine - 9, 2, 8);
        }
        // the part of the road already travelled, and the travelling dot
        const xd = x + barW * frac(s.t);
        ctx.strokeStyle = "#3dc1b2";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x, yLine);
        ctx.lineTo(xd, yLine);
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(xd, yLine, 5, 0, TAU);
        ctx.fill();

        // radius, temperature, mass and phase
        ctx.font = `${fs}px "Instrument Sans", system-ui, sans-serif`;
        let y = infoTop;
        for (const [name, value] of info) {
            y += lh;
            ctx.fillStyle = "rgba(232,236,245,0.55)";
            ctx.fillText(name, x, y);
            ctx.fillStyle = "rgba(242,245,251,0.95)";
            ctx.fillText(value, x + fs * 8.5, y);
        }
        ctx.restore();
    }
}


// ====================================================================================
// Binary stars: two stars orbiting each other, with phases of mass transfer
// ====================================================================================
// SeBa binary types: 2 detached, 3 semi-detached (stable mass transfer), 4 contact, 5 common envelope
// (gamma), 6 double spiral-in, 7 merged, 8 disrupted, 9 common envelope (alpha).
// Mass transfer types: 1 nuclear, 2 angular-momentum loss, 3 thermal timescale (all stable);
// 4 common envelope due to dynamics, 5 common envelope due to the Darwin-Riemann instability.
const isMT = (bt) => (bt >= 3 && bt <= 6) || bt === 9; // the stars interact (mass transfer or common envelope)
const isCEType = (bt) => bt === 5 || bt === 6 || bt === 9; // common envelope by binary type
const DISRUPTED = 8;

// Size of the Roche lobe (Eggleton 1983) in units of the separation;
// q = mass of this star divided by the mass of the other star
export function rocheLobe(q) {
    const q13 = Math.cbrt(q);
    const q23 = q13 * q13;
    return (0.49 * q23) / (0.6 * q23 + Math.log(1 + q13));
}

// Kepler's equation: the true anomaly (position in the orbit) for a mean anomaly M
export function trueAnomaly(M, e) {
    let E = M;
    for (let i = 0; i < 8; i++) {
        E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    }
    return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
}

// The time line of a binary run: like buildTimeline, but it also gives screen time to
// changes in the separation and the masses, and guarantees time for the main sequence
// and for the phases of mass transfer.
export function buildBinaryTimeline(rows) {
    const pts = [];
    let tEnd = 0;
    for (let i = 0; i < rows.time.length; i++) {
        const t = rows.time[i];
        const m1 = rows.m1[i];
        const R1 = rows.r1[i];
        const T1 = rows.T1[i];
        if (![t, m1, R1, T1].every(Number.isFinite) || T1 <= 0) {
            continue;
        }
        const bt = rows.bintype ? Math.round(rows.bintype[i]) : 0;
        const tt = rows.tt ? Math.round(rows.tt[i]) : NaN; // type of mass transfer (1, 2, 3: stable)
        const ty2 = rows.ty2 ? Math.round(rows.ty2[i]) : 3;
        const m2 = rows.m2[i];
        const R2 = rows.r2[i];
        const T2 = rows.T2[i];
        // after a merger there is no second star any more
        const has2 =
            [m2, R2, T2].every(Number.isFinite) && m2 > 0 && R2 > 0 && T2 > 0 && ty2 !== 20 && bt !== 7;
        const sep = rows.sep ? rows.sep[i] : NaN;
        const ecc = rows.ecc ? rows.ecc[i] : 0;
        pts.push({
            i,
            t,
            bt,
            tt,
            sep: Number.isFinite(sep) && sep > 0 ? sep : NaN,
            ecc: Number.isFinite(ecc) ? clamp(ecc, 0, 0.9) : 0,
            m1,
            R1: Math.max(R1, 1e-9),
            T1,
            ty1: Math.round(rows.ty1[i]),
            m2: has2 ? m2 : NaN,
            R2: has2 ? Math.max(R2, 1e-9) : NaN,
            T2: has2 ? T2 : NaN,
            ty2,
            has2,
        });
        tEnd = Math.max(tEnd, t);
    }
    if (!pts.length) {
        return null;
    }
    // the separation is not defined after a merger: carry the last known value forward
    let lastSep = pts.find((q) => Number.isFinite(q.sep))?.sep ?? 10;
    for (const q of pts) {
        if (Number.isFinite(q.sep)) {
            lastSep = q.sep;
        } else {
            q.sep = lastSep;
        }
    }

    // moments with a special effect
    const found = [];
    for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1];
        const b = pts[k];
        if (!isCompact(a.ty1) && (b.ty1 === 18 || b.ty1 === 19)) {
            found.push({ kind: "supernova", star: 1, k });
        } else if (isGiant(a.ty1) && isWD(b.ty1)) {
            found.push({ kind: "nebula", star: 1, k, R: a.R1 });
        }
        if (b.has2 && !isCompact(a.ty2) && (b.ty2 === 18 || b.ty2 === 19)) {
            found.push({ kind: "supernova", star: 2, k });
        } else if (b.has2 && isGiant(a.ty2) && isWD(b.ty2)) {
            found.push({ kind: "nebula", star: 2, k, R: a.R2 });
        }
        if (b.bt === 7 && a.bt !== 7) {
            found.push({ kind: "merger", star: 1, k });
        }
        if (b.bt === DISRUPTED && a.bt !== DISRUPTED) {
            found.push({ kind: "disrupt", star: 1, k });
        }
    }
    if (found.some((ev) => ev.k === pts.length - 1 && ev.kind !== "disrupt")) {
        pts.push({ ...pts[pts.length - 1] }); // room to look at what is left
    }

    const tFloor = Math.max(tEnd * 1e-5, 1e-4);
    for (const q of pts) {
        q.lt = Math.log10(Math.max(q.t, tFloor));
        q.lsep = Math.log10(q.sep);
        q.lr1 = clamp(Math.log10(q.R1), LOG_R_LO, LOG_R_HI);
        q.lr2 = q.has2 ? clamp(Math.log10(q.R2), LOG_R_LO, LOG_R_HI) : q.lr1;
        q.lT1 = Math.log10(clamp(q.T1, 500, 1e8));
        q.lT2 = q.has2 ? Math.log10(clamp(q.T2, 500, 1e8)) : q.lT1;
        q.lm1 = Math.log10(Math.max(q.m1, 1e-4));
        q.lm2 = q.has2 ? Math.log10(Math.max(q.m2, 1e-4)) : q.lm1;
    }

    // a quick shrinking of the orbit during mass transfer: the stars spiral in (common envelope)
    for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        a.ce = isMT(a.bt) && a.has2 && b.has2 && b.sep < 0.65 * a.sep;
    }
    pts[pts.length - 1].ce = false;

    // stable mass transfer (type 1, 2 or 3) goes a bit slower; unstable transfer (no timescale in SeBa,
    // or the orbit shrinks in one go) gets a stretch of movie time of its own below
    const stable = (q) => isMT(q.bt) && (q.tt === 1 || q.tt === 2 || q.tt === 3) && !q.ce && !isCEType(q.bt);
    const unstable = (q) => isMT(q.bt) && (q.ce || q.tt === 4 || q.tt === 5 || isCEType(q.bt));

    // unstable mass transfer: both stars end up inside one common envelope. The envelope is there from
    // the first unstable step (k0) until the phase ends (k); after that it is blown away.
    for (const q of pts) {
        q.unst = unstable(q);
    }
    if (pts[pts.length - 1].unst) {
        pts.push({ ...pts[pts.length - 1], unst: false, ce: false }); // room to see the envelope go
    }
    for (let k = 1; k < pts.length; k++) {
        if (pts[k - 1].unst && !pts[k].unst) {
            let k0 = k - 1;
            while (k0 > 0 && pts[k0 - 1].unst) {
                k0--;
            }
            found.push({ kind: "envelope", star: 1, k, k0 });
        }
    }
    // a star that becomes a white dwarf in the step in which the envelope is blown away does not get a
    // planetary nebula of its own: the envelope that is blown away is shown instead
    for (const env of found.filter((ev) => ev.kind === "envelope")) {
        for (let j = found.length - 1; j >= 0; j--) {
            if (found[j].kind === "nebula" && found[j].k === env.k) {
                found.splice(j, 1);
            }
        }
    }

    // movie time per step of the data
    const weights = [];
    const kind = [];
    for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1];
        const b = pts[k];
        const both = a.has2 && b.has2;
        const dR1 = b.lr1 - a.lr1;
        const dR2 = both ? b.lr2 - a.lr2 : 0;
        let w =
            0.9 * Math.max(0, b.lt - a.lt) +
            1.6 * (Math.max(0, dR1) + Math.max(0, dR2)) +
            0.25 * (Math.max(0, -dR1) + Math.max(0, -dR2)) +
            0.5 * Math.max(Math.abs(b.lT1 - a.lT1), both ? Math.abs(b.lT2 - a.lT2) : 0) +
            (both ? 1.2 * Math.abs(b.lsep - a.lsep) : 0) +
            2.5 * (Math.abs(b.lm1 - a.lm1) + (both ? Math.abs(b.lm2 - a.lm2) : 0)) +
            (a.ty1 !== b.ty1 || a.ty2 !== b.ty2 || a.bt !== b.bt ? 0.1 : 0);
        const collapse =
            (!isCompact(a.ty1) && isCompact(b.ty1)) || (both && !isCompact(a.ty2) && isCompact(b.ty2));
        if (collapse) {
            w = Math.min(w, 0.6);
        }
        if (stable(a)) {
            w *= 1.8;
        }
        const done = isCompact(a.ty1) && (!a.has2 || isCompact(a.ty2)) && !isMT(a.bt);
        if (done) {
            w *= 0.15;
        }
        weights.push(Math.max(w, 1e-3));
        kind.push(
            a.bt < 3 && a.ty1 === 3 && (!a.has2 || a.ty2 <= 3) ? "ms" : isMT(a.bt) ? "mt" : "", // star 2 may also be a planet or brown dwarf
        );
    }
    const sum = () => weights.reduce((x, y) => x + y, 0);
    // at least 22% of the movie for the quiet main sequence and 22% for mass transfer
    for (const label of ["ms", "mt"]) {
        const total = sum();
        let part = 0;
        weights.forEach((w, j) => {
            if (kind[j] === label) {
                part += w;
            }
        });
        if (part > 0 && part / total < 0.22) {
            const f = ((0.22 / 0.78) * (total - part)) / part;
            weights.forEach((w, j) => {
                if (kind[j] === label) {
                    weights[j] = w * f;
                }
            });
        }
    }
    // unstable mass transfer happens in no time in SeBa; give it a visible stretch of the movie
    // (about 10% per step, at most 20% altogether)
    const unst = [];
    for (let k = 0; k < weights.length; k++) {
        if (unstable(pts[k])) {
            unst.push(k);
        }
    }
    if (unst.length) {
        const share = Math.min(0.1, 0.2 / unst.length);
        const target = share * (sum() / (1 - share * unst.length));
        for (const k of unst) {
            weights[k] = Math.max(weights[k], target);
        }
    }
    // a supernova or merger needs some screen time afterwards, a planetary nebula as well
    for (const ev of found) {
        if (ev.k >= weights.length) {
            continue;
        }
        if (ev.kind === "supernova" || ev.kind === "merger") {
            weights[ev.k] = Math.max(weights[ev.k], 0.07 * sum());
        } else if (ev.kind === "nebula") {
            weights[ev.k] = Math.max(weights[ev.k], 0.18 * sum());
        } else if (ev.kind === "envelope") {
            weights[ev.k] = Math.max(weights[ev.k], 0.07 * sum());
        }
    }
    const cum = [0];
    for (let k = 1; k < pts.length; k++) {
        cum.push(cum[k - 1] + weights[k - 1]);
    }
    const p = cum.map((x) => x / (cum[cum.length - 1] || 1));

    const events = found.map((ev) => ({ ...ev, p: p[ev.k], t: pts[ev.k].t, p0: ev.k0 === undefined ? undefined : p[ev.k0] }));
    const dead = pts.find((q) => isCompact(q.ty1) && (!q.has2 || isCompact(q.ty2)));
    const first = pts[0];
    return {
        pts,
        p,
        tFloor,
        events,
        axis: niceAxis(dead && dead.t > 0 ? dead.t : tEnd),
        aRef: first.sep,
        mRef: first.m1 + (first.has2 ? first.m2 : 0),
    };
}

// The state of the binary at position `pos` (0 - 1) of the movie
export function stateAtB(tl, pos) {
    const { pts, p, tFloor } = tl;
    const x = clamp(pos, 0, 1);
    const last = pts.length - 1;
    let lo = 0;
    let hi = last;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (p[mid] <= x) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    const a = pts[lo];
    const b = lo >= last ? a : pts[lo + 1];
    const f = lo >= last ? 0 : (x - p[lo]) / (p[lo + 1] - p[lo] || 1);
    const both = a.has2 && b.has2;
    const geo = (u, v) => u * (v / u) ** f;
    return {
        t: f === 0 ? a.t : Math.max(10 ** lerp(a.lt, b.lt, f), tFloor),
        bt: a.bt,
        tt: a.tt,
        unst: isMT(a.bt) && (!!a.ce || a.tt === 4 || a.tt === 5 || isCEType(a.bt)),
        stab: isMT(a.bt) && !a.ce && !isCEType(a.bt) && (a.tt === 1 || a.tt === 2 || a.tt === 3),
        ce: !!a.ce,
        sep: geo(a.sep, b.sep),
        ecc: lerp(a.ecc, b.ecc, f),
        m1: lerp(a.m1, b.m1, f),
        R1: geo(a.R1, b.R1),
        T1: geo(a.T1, b.T1),
        ty1: a.ty1,
        has2: a.has2,
        ty2: a.ty2,
        m2: both ? lerp(a.m2, b.m2, f) : a.m2,
        R2: both ? geo(a.R2, b.R2) : a.R2,
        T2: both ? geo(a.T2, b.T2) : a.T2,
        i0: a.i,
        i1: b.i,
        f,
        p: x,
    };
}

function formatPeriod(days, lang, t) {
    const num = (v) =>
        v.toLocaleString(lang, {
            minimumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2,
            maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2,
        });
    if (days < 1) {
        return `${num(days * 24)} ${t("unit-hours")}`;
    }
    if (days < 730) {
        return `${num(days)} ${t("unit-days")}`;
    }
    return `${num(days / 365.25)} ${t("movie-unit-yr")}`;
}

const TILT = 0.5; // the orbit is seen at an angle
const BIN_TWIST = 0.4; // direction of the long axis of the orbit

export class BinaryMovie extends StarMovie {
    // ----- public
    load(rows) {
        this.timeline = buildBinaryTimeline(rows);
        if (this.downloadBtn) {
            this.downloadBtn.disabled = !this.timeline;
        }
        this.p = 0;
        this._syncSlider();
        if (this.timeline && !this.reduced) {
            this.play();
        } else {
            this.pause();
        }
        this.render();
    }

    // ----- drawing
    render() {
        const { ctx, W, H } = this;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        this._drawBackground();

        const lang = document.documentElement.lang || "en";
        const tl = this.timeline;
        if (!tl) {
            ctx.fillStyle = "rgba(232,236,245,0.75)";
            ctx.font = `${Math.max(13, W / 50)}px "Instrument Sans", system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText(this.t("movie-empty"), W / 2, H / 2);
            ctx.textAlign = "left";
            return;
        }
        const s = stateAtB(tl, this.p);
        if (this.onState && !this._forRecording) {
            this.onState(s);
        }

        // the orbit turns faster when it is tighter (Kepler's third law)
        const dt = this.sec - (this._lastSec ?? this.sec);
        this._lastSec = this.sec;
        if (s.has2) {
            const rate = clamp(Math.sqrt((s.m1 + s.m2) / tl.mRef) * (tl.aRef / s.sep) ** 1.5, 0.35, 5);
            this.orbitPhase = (this.orbitPhase ?? 0) + (TAU / 6) * rate * Math.max(0, dt);
        }

        if (s.has2) {
            this._drawPair(s);
        } else {
            this._drawAlone(s);
        }
        this._drawHUD(s, lang);
        if (this._forRecording) {
            this._drawWatermark();
        }
    }

    // One object on its own (a single star, or what is left after a merger)
    _drawAlone(s) {
        const { W, H } = this;
        const cx = W / 2;
        const cy = H / 2;
        const where = { 1: { x: cx, y: cy } };
        this._pairScale = null;
        const r = this._radiusPx(s.R1);
        const env = this._commonEnvelope();
        if (env) {
            this._drawEnvelope(cx, cy, Math.min(env.Rsol * (env.S0 || 1), 0.3 * this.H), env.c, env.alpha);
        }
        this._drawEventsB(where, r, false);
        this._drawBody(cx, cy, r, s.T1, s.ty1, 1);
        this._drawEventsB(where, r, true);
    }

    // The two stars on their orbit
    // Where the pair goes on the screen: the size of the orbit (aPx), the scale (S, pixels per solar
    // radius) and the radii of the two stars in pixels. With `Sfix` the scale is fixed (no zooming).
    _pairLayout(s, Sfix) {
        const { W, H } = this;
        const tl = this.timeline;
        const M = s.m1 + s.m2;
        const a = s.sep;
        const e = Math.min(s.ecc, 0.9);
        const lobe1 = rocheLobe(s.m1 / s.m2) * a; // Roche lobes, in solar radii
        const lobe2 = rocheLobe(s.m2 / s.m1) * a;

        // zoom: the orbit gets a size on the screen that follows the real separation a little
        let aPx = clamp(0.34 * W * (a / tl.aRef) ** 0.3, 0.16 * W, 0.44 * W);
        aPx = Math.min(aPx, (0.42 * W) / ((1 + e) * (Math.max(s.m1, s.m2) / M)));
        // a star that nearly fills its Roche lobe touches its neighbour; smaller stars are drawn
        // somewhat bigger than they are, otherwise they would be invisible
        // During stable mass transfer a star cannot be bigger than its Roche lobe: the gas that sticks out
        // flows to the other star. SeBa's finer output sometimes gives a larger radius there (the size the
        // star would have on its own), so the drawn star stops at its Roche lobe.
        const capAtLobe = isMT(s.bt) && !s.unst;
        const radii = (scale) => {
            const vis = (R, lobe) => {
                const rho = capAtLobe ? Math.min(R / lobe, 1) : R / lobe;
                return lobe * scale * (rho < 1 ? rho ** 0.6 : rho);
            };
            return [vis(s.R1, lobe1), vis(s.R2, lobe2)];
        };
        let S = aPx / a;
        let [r1, r2] = radii(S);
        const biggest = Math.max(r1, r2);
        if (biggest > 0.46 * H) {
            S *= (0.46 * H) / biggest; // zoom out when a star gets big
            [r1, r2] = radii(S);
        }
        if (Sfix) {
            S = Sfix;
            aPx = a * S;
            [r1, r2] = radii(S);
        }
        r1 = Math.max(r1, 0.012 * H);
        r2 = Math.max(r2, 0.01 * H);
        return { M, a, e, lobe1, lobe2, aPx, S, r1, r2 };
    }

    // The common envelope (unstable mass transfer): its size is set by the binary at the start of the
    // phase and stays the same while the orbit inside it shrinks; when the phase is over it expands and
    // fades away. Returns null when there is no envelope at this moment of the movie.
    _commonEnvelope() {
        const { H } = this;
        const tl = this.timeline;
        const SPAN = 0.07; // movie time over which the envelope is blown away
        for (const ev of tl.events) {
            if (ev.kind !== "envelope" || this.p < ev.p0 || this.p > ev.p + SPAN) {
                continue;
            }
            if (!ev._look || ev._look.H !== H || ev._look.W !== this.W) {
                const s0 = stateAtB(tl, ev.p0 + 1e-9);
                const L = s0.has2 ? this._pairLayout(s0) : null;
                // the envelope just wraps around the binary at the start (in solar radii, so that it keeps
                // its real size when the camera zooms) ...
                const Rsol = L ? (L.aPx * 0.6 + Math.max(L.r1, L.r2) * 0.3) / L.S : 0.3 * H;
                // ... and the camera zooms out a little, so that the envelope fills about half the picture
                const S0 = L ? Math.min(L.S / 1.5, (0.3 * H) / Rsol) : null;
                const donorIs1 = !L || s0.R1 / L.lobe1 >= s0.R2 / L.lobe2;
                const c = mix(starColor(donorIs1 ? s0.T1 : s0.T2), [200, 196, 200], 0.3);
                ev._look = { W: this.W, H, Rsol, c, S0 };
            }
            const smooth = (x) => {
                const t = clamp(x, 0, 1);
                return t * t * (3 - 2 * t);
            };
            if (this.p < ev.p) {
                const start = smooth((this.p - ev.p0) / 0.015); // the camera zooms out and the envelope forms
                return { Rsol: ev._look.Rsol, alpha: start, c: ev._look.c, S0: ev._look.S0, hold: start };
            }
            // blown away: it swells a little and fades; the camera only zooms back once it is mostly gone
            const u = (this.p - ev.p) / SPAN;
            return {
                Rsol: ev._look.Rsol * (1 + 0.35 * smooth(u)),
                alpha: (1 - u) ** 1.5,
                c: ev._look.c,
                S0: ev._look.S0,
                hold: 1 - smooth((u - 0.55) / 0.45),
            };
        }
        return null;
    }

    _drawPair(s) {
        const { ctx, W, H } = this;
        const tl = this.timeline;
        const cx = W / 2;
        const cy = H / 2;
        const bound = s.bt !== DISRUPTED;
        // during a common envelope the camera keeps the zoom of its start, so that you see the orbit
        // shrink inside the envelope; while the envelope is blown away the zoom eases back to normal
        const env = this._commonEnvelope();
        let Sfix;
        if (env && env.S0) {
            const Snormal = this._pairLayout(s).S;
            Sfix = Math.exp(lerp(Math.log(Snormal), Math.log(env.S0), env.hold));
        }
        const { M, a, e, lobe1, lobe2, aPx, S, r1, r2 } = this._pairLayout(s, Sfix);
        this._pairScale = S;
        if (env && bound) {
            this._drawEnvelope(cx, cy, env.Rsol * S, env.c, env.alpha); // behind the orbits and the stars
        }

        // where the stars are
        let nu = trueAnomaly(this.orbitPhase ?? 0, e);
        let rrel = (a * (1 - e * e)) / (1 + e * Math.cos(nu));
        if (!bound) {
            // the binary has been torn apart: the stars drift away from each other
            const ev = tl.events.find((q) => q.kind === "disrupt");
            const u = ev ? clamp((this.p - ev.p) / 0.3, 0, 1) : 1;
            nu = 0;
            rrel = a * (1 + 6 * u);
        }
        const th = nu + BIN_TWIST;
        const f1 = -s.m2 / M;
        const f2 = s.m1 / M;
        const at = (f) => ({
            x: cx + f * rrel * S * Math.cos(th),
            y: cy + f * rrel * S * Math.sin(th) * TILT,
        });
        const p1 = at(f1);
        const p2 = at(f2);

        // the paths of the two stars, and the centre of mass
        if (bound) {
            ctx.save();
            ctx.setLineDash([5, 6]);
            ctx.strokeStyle = "rgba(255,255,255,0.6)";
            ctx.lineWidth = 1.5;
            for (const f of [f1, f2]) {
                ctx.beginPath();
                for (let j = 0; j <= 72; j++) {
                    const v = (j / 72) * TAU;
                    const rr = (a * (1 - e * e)) / (1 + e * Math.cos(v));
                    const px = cx + f * rr * S * Math.cos(v + BIN_TWIST);
                    const py = cy + f * rr * S * Math.sin(v + BIN_TWIST) * TILT;
                    if (j === 0) {
                        ctx.moveTo(px, py);
                    } else {
                        ctx.lineTo(px, py);
                    }
                }
                ctx.stroke();
            }
            ctx.restore();
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.beginPath();
            ctx.arc(cx, cy, 2.5, 0, TAU);
            ctx.fill();
        }

        const where = { 1: p1, 2: p2 };
        const donorIs1 = s.R1 / lobe1 >= s.R2 / lobe2;
        const mt = isMT(s.bt) && bound && !s.unst; // during unstable transfer there is no stream, only the envelope
        this._drawEventsB(where, Math.max(r1, r2), false);

        // the star that is farther away is drawn first
        const bodies = [
            { p: p1, r: r1, T: s.T1, ty: s.ty1, label: "1" },
            { p: p2, r: r2, T: s.T2, ty: s.ty2, label: "2" },
        ].sort((u, v) => u.p.y - v.p.y);
        for (const b of bodies) {
            this._drawBody(b.p.x, b.p.y, b.r, b.T, b.ty, 0.6);
        }
        if (mt) {
            const donor = donorIs1 ? { p: p1, r: r1, T: s.T1 } : { p: p2, r: r2, T: s.T2 };
            const taker = donorIs1 ? { p: p2, r: r2, ty: s.ty2 } : { p: p1, r: r1, ty: s.ty1 };
            this._drawStream(donor, taker, false);
        }
        // the numbers of the stars
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = `600 ${clamp(W / 70, 11, 14)}px "Instrument Sans", system-ui, sans-serif`;
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 4;
        for (const b of bodies) {
            ctx.fillStyle = css(mix(starColor(b.T), [255, 255, 255], 0.4), 0.9);
            ctx.fillText(b.label, b.p.x, b.p.y + Math.max(b.r, 6) + clamp(W / 60, 13, 18));
        }
        ctx.restore();
        this._drawEventsB(where, Math.max(r1, r2), true);
        this._drawScaleBar(S);
    }

    // Draws one object, whatever it is (k: size factor of the compact objects)
    _drawBody(x, y, r, T, type, k) {
        if (type === 19) {
            this._drawBlackHole(x, y, k);
        } else if (type === 18) {
            this._drawNeutronStar(x, y, T, k);
        } else if (isWD(type)) {
            this._drawWhiteDwarf(x, y, Math.max(r, 0.02 * this.H * k), T);
        } else if (type === 1) {
            this._drawPlanet(x, y, r);
        } else if (type !== 20) {
            this._drawStar(x, y, r, T, type);
        }
    }

    _drawPlanet(x, y, r) {
        const { ctx } = this;
        const glow = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 2.4);
        glow.addColorStop(0, "rgba(120,170,255,0.35)");
        glow.addColorStop(1, "rgba(120,170,255,0)");
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.4, 0, TAU);
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.clip();
        const disc = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
        disc.addColorStop(0, "#9fc4ff");
        disc.addColorStop(0.7, "#4a78d0");
        disc.addColorStop(1, "#1d3470");
        ctx.fillStyle = disc;
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
        ctx.fillStyle = "rgba(255,255,255,0.16)";
        for (const dy of [-0.35, 0.05, 0.4]) {
            ctx.fillRect(x - r, y + dy * r, 2 * r, r * 0.16);
        }
        ctx.restore();
    }

    // Gas flowing from the donor to the star that receives it: a band that is narrow at the donor and
    // wider at the other star, with a denser middle and a soft edge, grains of gas in it, and a glowing
    // disc around the receiving star. `hard`: unstable mass transfer, a much thicker and wilder flow.
    // Colour of the gas (this.streamStyle): "tint" (default) = grey with a little of the donor's colour,
    // "grey" = neutral grey, "fire" = the old look (the donor's colour added up until it glows).
    _drawStream(donor, taker, hard = false) {
        const { ctx, sec } = this;
        const dx = taker.p.x - donor.p.x;
        const dy = taker.p.y - donor.p.y;
        const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d;
        const uy = dy / d;
        const x0 = donor.p.x + ux * donor.r * 0.8;
        const y0 = donor.p.y + uy * donor.r * 0.8;
        // an accretion disc only forms around a compact object: a white dwarf or neutron star gets one here,
        // a black hole already has its own; onto an ordinary star the gas falls straight onto the surface
        const disc = isWD(taker.ty) || taker.ty === 18;
        const gap = disc || taker.ty === 19 ? taker.r * 1.2 + 2 : taker.r * 0.85;
        const x1 = taker.p.x - ux * gap;
        const y1 = taker.p.y - uy * gap;
        const qx = (x0 + x1) / 2 - uy * d * (hard ? 0.22 : 0.1);
        const qy = (y0 + y1) / 2 + ux * d * (hard ? 0.22 : 0.1);
        const c = starColor(donor.T);
        const bez = (u) => ({
            x: (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * qx + u * u * x1,
            y: (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * qy + u * u * y1,
        });
        const neck = Math.max(2, donor.r * (hard ? 0.5 : 0.22));
        const wide = Math.max(taker.r * (hard ? 1.6 : 1.0), neck * 2.2, 5);
        const style = this.streamStyle || "tint";
        const gas = style === "grey" ? [150, 155, 168] : style === "tint" ? mix(c, [150, 156, 172], this.gasGrey ?? 0.3) : c;
        ctx.save();
        ctx.lineCap = "round";
        const N = 28;
        if (style !== "fire") {
            // the band is painted solid on a separate layer and then laid over the picture half see-through
            // with a soft edge: nothing piles up where the band overlaps itself, so it stays gas and never
            // turns into a bright, fiery blob (as it did when you looked along the stream)
            const cw = ctx.canvas.width;
            const ch = ctx.canvas.height;
            if (!this._gasLayer) {
                this._gasLayer = document.createElement("canvas");
            }
            const L = this._gasLayer;
            if (L.width !== cw || L.height !== ch) {
                L.width = cw;
                L.height = ch;
            }
            const g = L.getContext("2d");
            for (const [pass, alpha, blur] of [
                [0, hard ? 0.75 : 0.6, 3.5],
                [1, hard ? 0.9 : 0.8, 1.2],
            ]) {
                g.setTransform(1, 0, 0, 1, 0, 0);
                g.clearRect(0, 0, cw, ch);
                g.setTransform(ctx.getTransform()); // same scale (and zoom) as the picture itself
                g.lineCap = "round";
                g.strokeStyle = css(mix(gas, [255, 255, 255], pass ? 0.25 * (this.gasWhite ?? 0.5) : 0));
                for (let k = 0; k < N; k++) {
                    const u0 = k / N;
                    const u1 = (k + 1) / N;
                    const a = bez(u0);
                    const b = bez(u1);
                    const um = (u0 + u1) / 2;
                    const flow = 1 + 0.08 * Math.sin(um * 14 - sec * 5); // the gas swells a little as it flows
                    g.lineWidth = (neck + (wide - neck) * um ** 1.3) * (pass ? 0.45 : 1.25) * flow;
                    g.beginPath();
                    g.moveTo(a.x, a.y);
                    g.lineTo(b.x, b.y);
                    g.stroke();
                }
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.globalAlpha = alpha;
                ctx.filter = `blur(${(blur * this.dpr).toFixed(1)}px)`;
                ctx.drawImage(L, 0, 0);
                ctx.restore();
            }
        }
        ctx.globalCompositeOperation = "lighter";
        for (let pass = 0; pass < (style === "fire" ? 2 : 0); pass++) {
            for (let k = 0; k < N; k++) {
                const u0 = k / N;
                const u1 = (k + 1) / N;
                const a = bez(u0);
                const b = bez(u1);
                const um = (u0 + u1) / 2;
                const width = (neck + (wide - neck) * um ** 1.3) * (pass ? 0.45 : 1);
                const pulse = 0.75 + 0.25 * Math.sin(um * 14 - sec * 5);
                const alpha = (pass ? 0.34 : 0.2) * pulse * (hard ? 1.5 : 1) * Math.min(1, 0.4 + um * 2);
                ctx.strokeStyle = css(mix(c, [255, 255, 255], pass ? 0.55 : 0.2 + 0.3 * um), alpha.toFixed(3));
                ctx.lineWidth = width;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
        }
        // the grains: in the gas styles they are painted over each other (not added up), and there are fewer
        // when the stream is short (seen end-on), so they never pile up into a white blob
        if (style !== "fire") {
            ctx.globalCompositeOperation = "source-over";
        }
        const M = Math.round((hard ? 130 : 70) * (style === "fire" ? 1 : clamp(d / (8 * wide), 0.25, 1)));
        for (let k = 0; k < M; k++) {
            const u = (sec * (hard ? 0.7 : 0.4) + k / M) % 1;
            const hsh = Math.sin(k * 127.1 + 311.7) * 43758.5453;
            const jit = hsh - Math.floor(hsh) - 0.5; // -0.5 .. 0.5, fixed per grain
            const pt = bez(u);
            const width = neck + (wide - neck) * u ** 1.3;
            const off = jit * width * (hard ? 1.6 : 1.1) + (hard ? Math.sin(sec * 3 + k) * width * 0.15 : 0);
            const fade = Math.sin(Math.PI * u);
            ctx.fillStyle =
                style === "fire"
                    ? css(mix(c, [255, 255, 255], 0.3 + u * 0.5), (0.8 * fade).toFixed(3))
                    : css(mix(gas, [255, 255, 255], (0.1 + u * 0.25) * (this.gasWhite ?? 0.5)), (0.45 * fade).toFixed(3));
            ctx.beginPath();
            ctx.arc(pt.x - uy * off, pt.y + ux * off, 0.8 + 1.5 * fade, 0, TAU);
            ctx.fill();
        }
        // the disc around the receiving star (only a white dwarf or neutron star, see above)
        if (disc) {
            ctx.globalCompositeOperation = "lighter";
            const rx = Math.max(taker.r * 2.3, 10);
            ctx.translate(taker.p.x, taker.p.y);
            ctx.rotate(-0.25);
            ctx.lineWidth = Math.max(2, rx * 0.12);
            ctx.strokeStyle = css(gas, 0.28);
            ctx.beginPath();
            ctx.ellipse(0, 0, rx, rx * 0.36, 0, 0, TAU);
            ctx.stroke();
            ctx.lineWidth = 1.3;
            ctx.strokeStyle = css(mix(gas, [255, 255, 255], 0.6), style === "fire" ? 0.85 : 0.6);
            ctx.beginPath();
            ctx.ellipse(0, 0, rx * 0.92, rx * 0.33, 0, 0, TAU);
            ctx.stroke();
        }
        ctx.restore();
    }

    // The two stars inside one glowing gas cloud (common envelope); `alpha` fades it in and out.
    // A round cloud (a ball of gas seen from outside): see-through in the middle so that the stars stay
    // visible, denser towards a soft edge; faint spiral arms lie in the plane of the orbit.
    _drawEnvelope(cx, cy, R, c, alpha = 1) {
        if (!(alpha > 0.01) || !(R > 1)) {
            return;
        }
        const { ctx, sec } = this;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(cx, cy);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
        g.addColorStop(0, css(c, 0.26));
        g.addColorStop(0.6, css(c, 0.36));
        g.addColorStop(0.85, css(mix(c, [255, 255, 255], 0.12), 0.5));
        g.addColorStop(0.95, css(c, 0.22));
        g.addColorStop(1, css(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, TAU);
        ctx.fill();
        // the gas is stirred up by the stars orbiting inside it: two faint arms in the plane of the orbit
        ctx.scale(1, TILT);
        ctx.rotate(sec * 0.3);
        ctx.lineWidth = Math.max(1.5, R * 0.03);
        ctx.lineCap = "round";
        for (let arm = 0; arm < 2; arm++) {
            ctx.strokeStyle = css(mix(c, [255, 255, 255], 0.45), 0.18);
            ctx.beginPath();
            for (let j = 0; j <= 48; j++) {
                const v = (j / 48) * 3.6 + arm * Math.PI;
                const rr = R * 0.1 + (R * 0.75 * j) / 48;
                if (j === 0) {
                    ctx.moveTo(Math.cos(v) * rr, Math.sin(v) * rr);
                } else {
                    ctx.lineTo(Math.cos(v) * rr, Math.sin(v) * rr);
                }
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    // A scale bar at the upper right, like on a map: it shows a round length (in solar radii) and changes
    // when the camera zooms; while the zoom changes, "zooming in" or "zooming out" is shown under it.
    _drawScaleBar(S) {
        const { ctx, W, sec } = this;
        if (!(S > 0)) {
            return;
        }
        const fs = clamp(W / 58, 11, 16);
        const raw = (0.13 * W) / S; // solar radii in about 13% of the width
        const pow = 10 ** Math.floor(Math.log10(raw));
        let value = pow;
        for (const m of [1, 2, 5, 10]) {
            if (Math.abs(Math.log((m * pow) / raw)) < Math.abs(Math.log(value / raw))) {
                value = m * pow;
            }
        }
        const len = value * S;
        const x1 = W - W * 0.025;
        const x0 = x1 - len;
        const y = W * 0.025 + fs * 0.6;
        const lang = document.documentElement.lang || "en";
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.85)";
        ctx.shadowBlur = 4;
        ctx.strokeStyle = "rgba(242,245,251,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y - 5);
        ctx.lineTo(x0, y + 5);
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.moveTo(x1, y - 5);
        ctx.lineTo(x1, y + 5);
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.font = `${fs * 0.9}px "Instrument Sans", system-ui, sans-serif`;
        ctx.fillStyle = "rgba(242,245,251,0.9)";
        ctx.fillText(`${value.toLocaleString(lang, { maximumFractionDigits: 3 })} R☉`, (x0 + x1) / 2, y + fs * 1.35);
        // how fast the camera zooms (per second of the movie), smoothed
        const dt = sec - (this._zoomSec ?? sec);
        if (dt > 0 && this._zoomS > 0) {
            const rate = Math.log(S / this._zoomS) / dt;
            this._zoomRate = lerp(this._zoomRate ?? 0, rate, clamp(dt * 4, 0, 1));
        }
        this._zoomS = S;
        this._zoomSec = sec;
        const r = this._zoomRate ?? 0;
        const show = clamp((Math.abs(r) - 0.12) / 0.15, 0, 1);
        if (show > 0) {
            ctx.font = `600 ${fs * 0.85}px "Instrument Sans", system-ui, sans-serif`;
            ctx.fillStyle = `rgba(255,178,122,${(0.95 * show).toFixed(3)})`;
            ctx.fillText(this.t(r > 0 ? "movie-zoom-in" : "movie-zoom-out"), (x0 + x1) / 2, y + fs * 2.6);
        }
        ctx.restore();
    }

    // The planetary nebula: the photo of the Helix Nebula grows from the star and fades away again (u: 0 - 1)
    _drawHelix(cx, cy, u, overlay, hFinal) {
        if (overlay) {
            return;
        }
        const { ctx, H } = this;
        const smooth = (x) => {
            const t = clamp(x, 0, 1);
            return t * t * (3 - 2 * t);
        };
        const env = smooth(u / 0.2) * (1 - smooth((u - 0.45) / 0.55));
        if (env <= 0.001) {
            return;
        }
        const grow = 0.12 + 0.88 * (1 - (1 - u) ** 3);
        const h = hFinal * grow;
        const w = h * (this.helix.width / this.helix.height);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = env * 0.95;
        ctx.drawImage(this.helix, cx - w / 2, cy - h / 2, w, h);
        ctx.restore();
    }

    // Flashes and shells at the place where something happens (a supernova, a merger, a nebula)
    _drawEventsB(where, rStar, overlay) {
        const { ctx, W, H } = this;
        for (const ev of this.timeline.events) {
            const ref = where[ev.star] || where[1] || { x: W / 2, y: H / 2 };
            const big = ev.kind === "supernova" || ev.kind === "merger";
            if (ev.kind === "supernova" && !overlay) {
                const uRem = (this.p - ev.p) / 0.12;
                if (uRem >= 0 && uRem <= 1) {
                    this._drawRemnant(ref.x, ref.y, uRem, 0.7);
                }
            }
            const span0 = ev.kind === "nebula" ? (this.helix ? 0.14 : 0.09) : big ? 0.06 : 0;
            // never longer than what is left of the movie, so that nothing stays on screen at the end
            const span = span0 ? Math.min(span0, Math.max(1 - ev.p, 0.02)) : 0;
            const u = span ? (this.p - ev.p) / span : -1;
            if (u < 0 || u > 1) {
                continue;
            }
            if (ev.kind === "nebula" && this.helix) {
                const rg = this._pairScale ? ev.R * this._pairScale : this._radiusPx(ev.R);
                this._drawHelix(ref.x, ref.y, u, overlay, clamp((2 * rg * 1.4) / 0.8, 0.14 * H, 0.55 * H));
                continue;
            }
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            if (big) {
                const rs = Math.max(rStar, 0.04 * H) + u * 0.45 * H;
                const fade = (1 - u) ** 1.5;
                if (!overlay) {
                    const ring = ctx.createRadialGradient(ref.x, ref.y, rs * 0.7, ref.x, ref.y, rs);
                    ring.addColorStop(0, "rgba(255,150,80,0)");
                    ring.addColorStop(0.85, `rgba(255,170,90,${(0.7 * fade).toFixed(3)})`);
                    ring.addColorStop(1, "rgba(255,120,60,0)");
                    ctx.fillStyle = ring;
                    ctx.fillRect(0, 0, W, H);
                } else {
                    const flash = ctx.createRadialGradient(ref.x, ref.y, 0, ref.x, ref.y, rs * 0.8);
                    flash.addColorStop(0, `rgba(255,255,255,${(0.95 * (1 - u) ** 3).toFixed(3)})`);
                    flash.addColorStop(1, "rgba(255,200,120,0)");
                    ctx.fillStyle = flash;
                    ctx.fillRect(0, 0, W, H);
                }
            } else if (!overlay) {
                const rs = Math.max(rStar, 0.05 * H) + u * 0.4 * H;
                const fade = (1 - u) ** 1.3;
                const shell = ctx.createRadialGradient(ref.x, ref.y, rs * 0.75, ref.x, ref.y, rs);
                shell.addColorStop(0, "rgba(120,220,255,0)");
                shell.addColorStop(0.6, `rgba(120,220,255,${(0.45 * fade).toFixed(3)})`);
                shell.addColorStop(0.85, `rgba(255,130,210,${(0.4 * fade).toFixed(3)})`);
                shell.addColorStop(1, "rgba(255,130,210,0)");
                ctx.fillStyle = shell;
                ctx.fillRect(0, 0, W, H);
            }
            ctx.restore();
        }
    }

    // ----- text: time and ruler and star 1 at the lower left, star 2 at the lower right,
    // the orbit at the upper left and what the two stars are doing in the middle at the top
    _drawHUD(s, lang) {
        const { ctx, W, H } = this;
        const t = this.t;
        const fs = clamp(W / 58, 11, 16);
        const lh = fs * 1.5;
        const xl = W * 0.025;
        const xr = W - W * 0.025;
        const blockW = fs * 15;
        // a planet (type 1) gets its mass and radius in Earth (or Jupiter) units: in solar units it would read 0,000
        const planetMass = (m) => {
            const me = m * 332946;
            return me < 100
                ? `${me.toLocaleString(lang, { maximumSignificantDigits: 3 })} ${t("unit-earth-mass")}`
                : `${(me / 317.83).toLocaleString(lang, { maximumSignificantDigits: 3 })} ${t("unit-jupiter-mass")}`;
        };
        const planetRadius = (R) => `${(R / 0.009168).toLocaleString(lang, { maximumSignificantDigits: 3 })} ${t("unit-earth-radius")}`;
        const starLines = (m, R, T, type) => [
            [t("movie-radius"), type === 1 ? planetRadius(R) : formatRadius(R, lang, t)],
            [t("movie-temp"), `${(Math.round(T / 10) * 10).toLocaleString(lang)} ${t("unit-kelvin")}`],
            [
                t("movie-mass"),
                type === 1
                    ? planetMass(m)
                    : `${m.toLocaleString(lang, { minimumFractionDigits: m < 1 ? 3 : 2, maximumFractionDigits: m < 1 ? 3 : 2 })} ${t("unit-mass")}`,
            ],
            [t("movie-phase"), t(`type-${type}`)],
        ];
        const left = starLines(s.m1, s.R1, s.T1, s.ty1);
        const right = s.has2 ? starLines(s.m2, s.R2, s.T2, s.ty2) : [];
        const rows = left.length + 1; // plus the heading
        const infoTop = H - W * 0.02 - rows * lh;

        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.85)";
        ctx.shadowBlur = 4;
        ctx.textBaseline = "alphabetic";

        // star 1 (left) and star 2 (right)
        const block = (lines, title, color, x, align) => {
            ctx.textAlign = align;
            ctx.font = `600 ${fs}px "Instrument Sans", system-ui, sans-serif`;
            ctx.fillStyle = css(mix(color, [255, 255, 255], 0.3));
            ctx.fillText(title, x, infoTop + lh);
            ctx.font = `${fs}px "Instrument Sans", system-ui, sans-serif`;
            let y = infoTop + lh;
            for (const [name, value] of lines) {
                y += lh;
                ctx.fillStyle = "rgba(232,236,245,0.55)";
                ctx.textAlign = "left";
                ctx.fillText(name, align === "left" ? x : x - blockW, y);
                ctx.fillStyle = "rgba(242,245,251,0.95)";
                ctx.textAlign = align === "left" ? "left" : "right";
                ctx.fillText(value, align === "left" ? x + fs * 8.5 : x, y);
            }
        };
        block(left, `${t("movie-star")} 1`, starColor(s.T1), xl, "left");
        if (s.has2) {
            if (s.ty2 === 1) {
                block(right, t("movie-planet"), [120, 170, 255], xr, "right");
            } else {
                block(right, `${t("movie-star")} 2`, starColor(s.T2), xr, "right");
            }
        }

        // the orbit
        if (s.has2) {
            const days = 365.25 * Math.sqrt((s.sep / 215.032) ** 3 / (s.m1 + s.m2));
            const orbit = [
                [t("movie-period"), days > 0 ? formatPeriod(days, lang, t) : "–"],
                [t("movie-sep"), `${s.sep.toLocaleString(lang, { maximumFractionDigits: s.sep < 10 ? 1 : 0 })} ${t("unit-sep")}`],
                [t("movie-ecc"), s.ecc.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
            ];
            let y = W * 0.025 + fs;
            ctx.textAlign = "left";
            ctx.font = `${fs}px "Instrument Sans", system-ui, sans-serif`;
            for (const [name, value] of orbit) {
                ctx.fillStyle = "rgba(232,236,245,0.55)";
                ctx.fillText(name, xl, y);
                ctx.fillStyle = "rgba(242,245,251,0.95)";
                ctx.fillText(value, xl + fs * 8.5, y);
                y += lh;
            }
        }

        // what the two stars are doing
        const status = s.unst ? t("transfertype-4") : s.stab ? t("transfertype-1") : t(`bintype-${s.bt}`);
        if (status) {
            const hot = isMT(s.bt) || s.bt === 7 || s.bt === DISRUPTED;
            ctx.textAlign = "center";
            ctx.font = `600 ${fs * 1.15}px "Instrument Sans", system-ui, sans-serif`;
            ctx.fillStyle = hot ? "#ffb27a" : "rgba(232,236,245,0.6)";
            ctx.fillText(status, W / 2, W * 0.025 + fs);
        }

        this._drawTimeRuler(s, lang, xl, infoTop - 8 - fs * 0.85 - fs * 0.5, fs);
        ctx.restore();
    }

    // The time, with the ruler under it (same as in the single-star movie)
    _drawTimeRuler(s, lang, x, yLine, fs) {
        const { ctx, W } = this;
        const barW = Math.min(W * 0.27, 260);
        const { max, step, n } = this.timeline.axis;
        const frac = (v) => clamp(v / max, 0, 1);
        ctx.textAlign = "left";
        ctx.fillStyle = "#f2f5fb";
        ctx.font = `600 ${fs * 1.5}px "Instrument Sans", system-ui, sans-serif`;
        ctx.fillText(formatTime(s.t, lang, this.t), x, yLine - 16);
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, yLine);
        ctx.lineTo(x + barW, yLine);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        for (let i = 0; i <= n; i++) {
            const xi = x + barW * ((i * step) / max);
            ctx.beginPath();
            ctx.moveTo(xi, yLine);
            ctx.lineTo(xi, yLine + 8);
            ctx.stroke();
        }
        const unit =
            max >= 1000
                ? { f: 1e-3, name: this.t("movie-unit-gyr") }
                : max >= 0.1
                  ? { f: 1, name: this.t("movie-unit-myr") }
                  : { f: 1e3, name: this.t("movie-unit-kyr") };
        const numFont = fs * 0.8;
        ctx.font = `${numFont}px "Instrument Sans", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(232,236,245,0.75)";
        const label = (v) => (v * unit.f).toLocaleString(lang, { maximumFractionDigits: 2, useGrouping: false });
        const widest = Math.max(...Array.from({ length: n + 1 }, (_, i) => ctx.measureText(label(i * step)).width));
        const skip = Math.max(1, Math.ceil((widest + 8) / (barW / n)));
        for (let i = 0; i <= n; i += skip) {
            ctx.fillText(label(i * step), x + barW * ((i * step) / max), yLine + 8 + numFont + 2);
        }
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(232,236,245,0.5)";
        ctx.fillText(unit.name, x + barW + 8, yLine + 4);
        for (const ev of this.timeline.events) {
            ctx.fillStyle = ev.kind === "supernova" ? "#ff9d6a" : ev.kind === "merger" ? "#ffd27a" : "#78dcff";
            ctx.fillRect(x + barW * frac(ev.t) - 1, yLine - 9, 2, 8);
        }
        const xd = x + barW * frac(s.t);
        ctx.strokeStyle = "#3dc1b2";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x, yLine);
        ctx.lineTo(xd, yLine);
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(xd, yLine, 5, 0, TAU);
        ctx.fill();
    }
}
