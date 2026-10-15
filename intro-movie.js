// intro-movie.js – the moving picture in the intro of the main page.
// It is drawn with the same code as the simulator movies (star-movie.js), so the stars,
// the gas stream and the supernova look exactly like they do in the simulators.
//
// Two versions:
//   mode "scene": everything at once – stars of different colours, a star with a planet,
//                 a giant that passes gas to a white dwarf, a supernova that keeps going off and a white dwarf
//   mode "story": a loop of 47 s: it opens with the scene above, zooms in on the star like the Sun and
//                 then tells four chapters: a star like the Sun, the same kind of star with two planets,
//                 a binary star, a heavy star that explodes; then it zooms back out to the scene.
//                 With a line of text per step

import { BinaryMovie, starColor, rocheLobe } from "./star-movie.js?v=24";

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, f) => a + (b - a) * f;
const smooth = (x) => {
    const t = clamp(x, 0, 1);
    return t * t * (3 - 2 * t);
};
// change on a logarithmic scale between a and b (for radius and temperature)
const glog = (a, b, f) => a * (b / a) ** clamp(f, 0, 1);

const TILT = 0.5; // orbits are seen at an angle, as in the binary movie
const TWIST = 0.4;

// seconds per chapter of the story: the overview, the Sun-like star, its planets, the binary, the heavy star
const CHAPTERS = [8, 9, 12, 9, 9];
// the overview: zoom out from the supernova at the start, zoom in on the star like the Sun at the end
const OVERVIEW = { zoomOut: 1.6, zoomIn: 1.8, scale: 3.2, sun: [0.21, 0.77], boom: [0.63, 0.3] };
const CAPTIONS = [
    [
        [0, "Een greep uit je universum", "A glimpse of your universe"],
        [0.55, "We zoomen in op een ster als de zon…", "We zoom in on a star like the Sun…"],
    ],
    [
        [0, "Een ster als de zon schijnt miljarden jaren rustig", "A star like the Sun shines quietly for billions of years"],
        [0.22, "Dan zwelt ze op tot een rode reus", "Then it swells up into a red giant"],
        [0.62, "Ze blaast haar buitenlagen weg: er blijft een witte dwerg over", "It blows away its outer layers, leaving a white dwarf"],
    ],
    [
        [0, "En wat gebeurt er met haar planeten?", "And what happens to its planets?"],
        [0.18, "Ze zwelt op tot een rode reus…", "It swells up into a red giant…"],
        [0.31, "Haar wind blaast massa weg: de buitenste planeet drijft naar buiten", "Its wind blows mass away: the outer planet drifts outward"],
        [0.5, "…en ze slokt de binnenste planeet op", "…and it swallows the inner planet"],
        [0.66, "Er blijft een witte dwerg over, met één planeet", "A white dwarf is left, with one planet"],
    ],
    [
        [0, "Twee sterren draaien om elkaar heen", "Two stars orbit each other"],
        [0.28, "De zwaarste zwelt op…", "The heavier one swells up…"],
        [0.5, "…en geeft gas door aan haar buur", "…and passes gas to its companion"],
    ],
    [
        [0, "Een zware ster leeft snel", "A heavy star lives fast"],
        [0.18, "Ze wordt een rode superreus…", "It becomes a red supergiant…"],
        [0.45, "…en ontploft als supernova. Er blijft een neutronenster over", "…and explodes as a supernova, leaving a neutron star"],
    ],
];

// The language the page shows: the pressed NL | EN button (the page opens in Dutch), otherwise <html lang>
function introLang() {
    const pressed = document.querySelector('.lang button[aria-pressed="true"]');
    const l = pressed ? pressed.dataset.lang : document.documentElement.lang;
    return l === "en" ? "en" : "nl";
}

export class IntroMovie extends BinaryMovie {
    constructor(opts) {
        const lang = () => introLang();
        const words = {
            nl: { sun: "Zon", "movie-aria": "Bewegend beeld van sterren, een ster met een planeet, een dubbelster en een supernova" },
            en: { sun: "Sun", "movie-aria": "Moving picture of stars, a star with a planet, a binary star and a supernova" },
        };
        super({ ...opts, t: (key) => words[lang()][key] || key });
        this.mode = ["story", "mt"].includes(opts.mode) ? opts.mode : "scene";
        this.streamStyle = opts.streamStyle || "tint"; // colour of the gas stream (see _drawStream)
        this.render();
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
        if (this.mode === "story") {
            this._story();
        } else if (this.mode === "mt") {
            this._chapterBinary(0.85); // only the binary with mass transfer (to compare gas colours)
        } else {
            this._scene();
        }
    }

    // ---------------------------------------------------------------- shared pieces

    // A flash with a ring of hot gas (supernova); `reach`: how far the ring goes, as part of the height
    _blast(cx, cy, r, u, overlay, reach = 0.62) {
        if (u < 0 || u > 1) {
            return;
        }
        const { ctx, W, H } = this;
        const rs = Math.max(r, 0.04 * H * reach) + u * reach * H;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        if (!overlay) {
            const fade = (1 - u) ** 1.5;
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
        }
        ctx.restore();
    }

    // The planetary nebula: the Helix photo when it is there, otherwise a glowing shell
    _nebula(cx, cy, r, u) {
        if (u < 0 || u > 1) {
            return;
        }
        const { ctx, W, H } = this;
        if (this.helix) {
            // same size rule as in the binary simulator: about 3.5 times the diameter of the giant,
            // at least 14% and at most 55% of the height of the picture
            this._drawHelix(cx, cy, u, false, clamp((2 * r * 1.4) / 0.8, 0.14 * H, 0.55 * H));
            return;
        }
        const rs = Math.max(r, 0.05 * H) + u * 0.45 * H;
        const fade = (1 - u) ** 1.3;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const shell = ctx.createRadialGradient(cx, cy, rs * 0.75, cx, cy, rs);
        shell.addColorStop(0, "rgba(120,220,255,0)");
        shell.addColorStop(0.6, `rgba(120,220,255,${(0.45 * fade).toFixed(3)})`);
        shell.addColorStop(0.85, `rgba(255,130,210,${(0.4 * fade).toFixed(3)})`);
        shell.addColorStop(1, "rgba(255,130,210,0)");
        ctx.fillStyle = shell;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }

    // Two stars on a circular orbit around (cx, cy); returns where they are
    _pair(cx, cy, aPx, m1, m2, phase) {
        const { ctx } = this;
        const M = m1 + m2;
        const f1 = -m2 / M;
        const f2 = m1 / M;
        const at = (f, v) => ({
            x: cx + f * aPx * Math.cos(v + TWIST),
            y: cy + f * aPx * Math.sin(v + TWIST) * TILT,
        });
        ctx.save();
        ctx.setLineDash([5, 6]);
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 1.2;
        for (const f of [f1, f2]) {
            ctx.beginPath();
            for (let j = 0; j <= 72; j++) {
                const q = at(f, (j / 72) * TAU);
                if (j === 0) {
                    ctx.moveTo(q.x, q.y);
                } else {
                    ctx.lineTo(q.x, q.y);
                }
            }
            ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, TAU);
        ctx.fill();
        return [at(f1, phase), at(f2, phase)];
    }

    // Draws two bodies, the one farther away first
    _drawInOrder(list) {
        list.sort((u, v) => u.p.y - v.p.y).forEach((b) => b.draw());
    }

    // ---------------------------------------------------------------- version 1: everything at once
    // `boomClock`: the clock of the supernova (in the story it starts as the remnant of the last chapter)
    _scene(boomClock = this.sec) {
        const { W, H, sec } = this;

        // a red giant, a hot blue star, a yellow-white star and a white dwarf
        this._drawStar(0.17 * W, 0.27 * H, 0.15 * H, 3600, 5);
        this._drawStar(0.88 * W, 0.14 * H, 0.03 * H, 22000, 3);
        this._drawStar(0.43 * W, 0.11 * H, 0.018 * H, 7000, 3);
        this._drawWhiteDwarf(0.42 * W, 0.53 * H, 0.011 * H, 20000);

        // a supernova that keeps going off: a hot star, the flash, the remnant with a neutron star in it
        {
            const x = 0.63 * W;
            const y = 0.3 * H;
            const f = this.reduced ? 0.55 : ((((boomClock + 4) % 12) + 12) % 12) / 12;
            const fx = 0.25;
            if (f < fx) {
                this._drawStar(x, y, 0.028 * H * smooth(f / 0.05), 16000, 3);
            } else {
                const u = (f - fx) / (1 - fx);
                this._drawRemnant(x, y, u, 0.3);
                this._blast(x, y, 0.028 * H, u / 0.12, false, 0.25);
                this._drawNeutronStar(x, y, 30000, 0.45 * (1 - smooth((f - 0.92) / 0.08)));
                this._blast(x, y, 0.028 * H, u / 0.12, true, 0.25);
            }
        }

        // a binary: a giant passes gas to a white dwarf, which gathers it in an accretion disc
        {
            const cx = 0.72 * W;
            const cy = 0.7 * H;
            const [p1, p2] = this._pair(cx, cy, 0.18 * W, 1.2, 0.8, (sec * TAU) / 10);
            const donor = { p: p1, r: 0.07 * H, T: 4300 };
            const taker = { p: p2, r: 0.014 * H, T: 25000, ty: 12 };
            this._drawInOrder([
                { p: p1, draw: () => this._drawStar(p1.x, p1.y, donor.r, donor.T, 5) },
                { p: p2, draw: () => this._drawWhiteDwarf(p2.x, p2.y, taker.r, taker.T) },
            ]);
            this._drawStream(donor, taker, false);
        }

        // a star like the Sun with a planet
        {
            const cx = 0.21 * W;
            const cy = 0.77 * H;
            const rx = 0.13 * W;
            const ry = 0.05 * W;
            const { ctx } = this;
            ctx.save();
            ctx.setLineDash([3, 5]);
            ctx.strokeStyle = "rgba(255,255,255,0.3)";
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
            ctx.stroke();
            ctx.restore();
            const v = (sec * TAU) / 8;
            const pl = { x: cx + rx * Math.cos(v), y: cy + ry * Math.sin(v) };
            this._drawInOrder([
                { p: { y: cy }, draw: () => this._drawStar(cx, cy, 0.05 * H, 5800, 3) },
                { p: pl, draw: () => this._drawPlanet(pl.x, pl.y, 0.016 * H) },
            ]);
        }

    }

    // ---------------------------------------------------------------- version 2: a short story
    _story() {
        const { ctx, W, H } = this;
        const total = CHAPTERS.reduce((a, b) => a + b, 0);
        // (the clock can start a hair below zero, hence the double modulo)
        // without motion: the binary, during mass transfer
        const T = this.reduced ? CHAPTERS[0] + CHAPTERS[1] + CHAPTERS[2] + 6 : ((this.sec % total) + total) % total;
        let ch = 0;
        let t = T;
        while (ch < CHAPTERS.length - 1 && t >= CHAPTERS[ch]) {
            t -= CHAPTERS[ch];
            ch++;
        }
        const len = CHAPTERS[ch];
        const u = Math.min(t / len, 1);
        [this._chapterOverview, this._chapterSun, this._chapterPlanets, this._chapterBinary, this._chapterSupernova][ch].call(this, u, t);

        // the line of text for this step
        const lines = CAPTIONS[ch];
        let line = lines[0];
        for (const l of lines) {
            if (u >= l[0]) {
                line = l;
            }
        }
        const text = introLang() === "en" ? line[2] : line[1];
        const since = (u - line[0]) * len;
        this._caption(text, this.reduced ? 1 : smooth(since / 0.5));

        // little dots: which chapter this is
        ctx.save();
        for (let k = 0; k < CAPTIONS.length; k++) {
            ctx.fillStyle = k === ch ? "#3dc1b2" : "rgba(255,255,255,0.3)";
            ctx.beginPath();
            ctx.arc(W / 2 + (k - (CAPTIONS.length - 1) / 2) * 14, H - 0.05 * H, 3.5, 0, TAU);
            ctx.fill();
        }
        ctx.restore();

        // fade to black between the chapters
        const fade = this.reduced ? 1 : Math.min(1, t / 0.7, (len - t) / 0.7);
        if (fade < 1) {
            ctx.fillStyle = `rgba(0,0,0,${(1 - fade).toFixed(3)})`;
            ctx.fillRect(0, 0, W, H);
        }
    }

    // Chapter 0: the overview (the scene). It starts zoomed in on the supernova, where the last chapter
    // ended, and zooms out; at the end it zooms in on the star like the Sun, where the next chapter begins.
    // The background stars stay put, only the objects zoom.
    _chapterOverview(u, t) {
        const { ctx, W, H } = this;
        const len = CHAPTERS[0];
        const out = this.reduced ? 1 : smooth(t / OVERVIEW.zoomOut);
        const inn = this.reduced ? 0 : smooth((t - (len - OVERVIEW.zoomIn)) / OVERVIEW.zoomIn);
        let s = 1;
        let fx = 0.5;
        let fy = 0.5;
        if (inn > 0) {
            s = lerp(1, OVERVIEW.scale, inn);
            [fx, fy] = OVERVIEW.sun;
        } else if (out < 1) {
            s = lerp(OVERVIEW.scale, 1, out);
            [fx, fy] = OVERVIEW.boom;
        }
        // the point we zoom on slides to the middle of the picture as we zoom in
        const g = (s - 1) / (OVERVIEW.scale - 1);
        const px = fx * W;
        const py = fy * H;
        const tx = lerp(px, W / 2, g);
        const ty = lerp(py, H * 0.54, g);
        ctx.save();
        ctx.translate(tx, ty);
        ctx.scale(s, s);
        ctx.translate(-px, -py);
        this._scene(t + 3.2); // the supernova starts as a remnant, like at the end of the last chapter
        ctx.restore();
    }

    _caption(text, alpha) {
        const { ctx, W, H } = this;
        const fs = clamp(W / 32, 13, 19);
        ctx.save();
        ctx.font = `600 ${fs}px "Instrument Sans", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 5;
        ctx.fillStyle = `rgba(255,178,122,${alpha.toFixed(3)})`;
        // wrap onto two lines when the screen is narrow
        const words = text.split(" ");
        const out = [];
        let cur = "";
        for (const w of words) {
            const next = cur ? `${cur} ${w}` : w;
            if (ctx.measureText(next).width > W * 0.88 && cur) {
                out.push(cur);
                cur = w;
            } else {
                cur = next;
            }
        }
        out.push(cur);
        out.forEach((l, i) => ctx.fillText(l, W / 2, 0.06 * H + fs + i * fs * 1.3));
        ctx.restore();
    }

    // Chapter 1: main sequence, red giant, planetary nebula and white dwarf
    _chapterSun(u) {
        const { W, H } = this;
        const cx = W / 2;
        const cy = H * 0.54;
        this._drawSunRing(cx, cy);
        const grow = smooth((u - 0.22) / 0.4);
        if (u < 0.62) {
            const R = glog(1, 1.4, u / 0.22) * glog(1, 110, grow);
            const T = glog(5800, 3500, grow);
            this._drawStar(cx, cy, this._radiusPx(R), T, grow > 0.5 ? 9 : grow > 0.05 ? 5 : 3);
        } else {
            const v = (u - 0.62) / 0.38;
            // the outer layers drift away, the hot core is left
            this._nebula(cx, cy, this._radiusPx(110), v);
            const shrink = smooth(v / 0.25);
            if (shrink < 1) {
                this._drawStar(cx, cy, this._radiusPx(glog(110, 0.02, shrink)), glog(3500, 4500, shrink), 9);
            }
            this._drawWhiteDwarf(cx, cy, Math.max(this._radiusPx(0.013), 0.02 * H), 60000);
        }
    }

    // Chapter 2: the same kind of star, now with two planets. The star swells into a red giant and swallows
    // the inner planet; its wind carries mass away, so its gravity weakens and the orbit of the outer
    // planet widens (a ∝ 1/M); the outer layers become a planetary nebula, a white dwarf is left.
    // Sizes of the star and the orbits use one scale (R^0.45), so that both fit on the screen.
    _chapterPlanets(u) {
        const { ctx, W, H, sec } = this;
        const cx = W / 2;
        const cy = H * 0.54;
        const px = (R) => 0.035 * H * Math.max(R, 1e-3) ** 0.45; // solar radii -> pixels
        const grow = smooth((u - 0.22) / 0.4);
        const Rstar = (g, uu) => glog(1, 1.3, uu / 0.22) * glog(1, 150, g); // radius in solar radii
        const aInner = (g) => 80 * (1 - 0.2 * g); // like Mercury; the tides of the giant pull it in a little
        // the moment the giant reaches the inner planet
        if (this._uEngulf === undefined) {
            this._uEngulf = 1;
            for (let k = 0; k <= 400; k++) {
                const uu = (0.62 * k) / 400;
                const g = smooth((uu - 0.22) / 0.4);
                if (Rstar(g, uu) >= aInner(g)) {
                    this._uEngulf = uu;
                    break;
                }
            }
        }
        const eaten = u >= this._uEngulf;
        const M = lerp(1, 0.55, smooth((u - 0.35) / 0.35)); // mass of the star, in solar masses
        const aOuter = 215 / M; // like the Earth: the orbit widens when the star loses mass

        // the planets move faster on a tight orbit around a heavy star (Kepler)
        const dt = Math.max(0, sec - (this._lastSecP ?? sec));
        this._lastSecP = sec;
        const omega = (a) => (TAU / 3.2) * (80 / a) ** 1.5 * Math.sqrt(M);
        this._phIn = (this._phIn ?? 0.5) + omega(aInner(grow)) * dt;
        this._phOut = (this._phOut ?? 2.6) + omega(aOuter) * dt;
        const spot = (a, ph) => ({ x: cx + px(a) * Math.cos(ph), y: cy + px(a) * Math.sin(ph) * TILT });
        const pin = spot(aInner(grow), this._phIn);
        const pout = spot(aOuter, this._phOut);

        // the orbits
        ctx.save();
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1;
        for (const a of eaten ? [aOuter] : [aInner(grow), aOuter]) {
            ctx.beginPath();
            ctx.ellipse(cx, cy, px(a), px(a) * TILT, 0, 0, TAU);
            ctx.stroke();
        }
        ctx.restore();

        // the star (or what is left of it)
        let drawStar;
        let rNow;
        if (u < 0.62) {
            const R = Rstar(grow, u);
            const T = glog(5800, 3500, grow);
            rNow = px(R);
            drawStar = () => this._drawStar(cx, cy, rNow, T, grow > 0.5 ? 9 : grow > 0.05 ? 5 : 3);
        } else {
            const v = (u - 0.62) / 0.38;
            const shrink = smooth(v / 0.25);
            rNow = px(glog(150, 0.013, shrink));
            this._nebula(cx, cy, px(150), v); // the outer layers drift away
            drawStar = () => {
                if (shrink < 1) {
                    this._drawStar(cx, cy, rNow, glog(3500, 4500, shrink), 9);
                }
                this._drawWhiteDwarf(cx, cy, 0.02 * H, 60000); // the hot core, at its own (small) size
            };
        }

        // planets behind the star first, then the star, then planets in front
        const planets = [{ p: pout, r: 0.02 * H }];
        if (!eaten) {
            planets.push({ p: pin, r: 0.014 * H });
        }
        for (const q of planets.filter((q) => q.p.y < cy)) {
            this._drawPlanet(q.p.x, q.p.y, q.r);
        }
        drawStar();
        for (const q of planets.filter((q) => q.p.y >= cy)) {
            this._drawPlanet(q.p.x, q.p.y, q.r);
        }

        // a glow where the inner planet disappeared into the giant
        const fl = (u - this._uEngulf) / 0.07;
        if (fl >= 0 && fl <= 1) {
            const g = ctx.createRadialGradient(pin.x, pin.y, 0, pin.x, pin.y, 0.09 * H);
            g.addColorStop(0, `rgba(255,240,200,${(0.9 * (1 - fl) ** 2).toFixed(3)})`);
            g.addColorStop(1, "rgba(255,160,90,0)");
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = g;
            ctx.fillRect(pin.x - 0.1 * H, pin.y - 0.1 * H, 0.2 * H, 0.2 * H);
            ctx.restore();
        }
    }

    // Chapter 2: a binary with stable mass transfer
    _chapterBinary(u) {
        const { W, H, sec } = this;
        const cx = W / 2;
        const cy = H * 0.52;
        const m1 = lerp(1.5, 0.9, smooth((u - 0.5) / 0.5));
        const m2 = lerp(1.0, 1.6, smooth((u - 0.5) / 0.5));
        const aPx = lerp(0.3 * W, 0.34 * W, smooth((u - 0.5) / 0.5)); // the orbit widens a little
        const lobe1 = rocheLobe(m1 / m2) * aPx;
        const swell = smooth((u - 0.28) / 0.24);
        const r1 = lerp(0.055 * H, 0.95 * lobe1, swell);
        const T1 = glog(6800, 4300, swell);
        const gain = smooth((u - 0.5) / 0.5);
        const r2 = lerp(0.04 * H, 0.05 * H, gain);
        const T2 = glog(8500, 12500, gain);
        const [p1, p2] = this._pair(cx, cy, aPx, m1, m2, (sec * TAU) / 6);
        this._drawInOrder([
            { p: p1, draw: () => this._drawStar(p1.x, p1.y, r1, T1, swell > 0.3 ? 5 : 3) },
            { p: p2, draw: () => this._drawStar(p2.x, p2.y, r2, T2, 3) },
        ]);
        if (u >= 0.5) {
            this._drawStream({ p: p1, r: r1, T: T1 }, { p: p2, r: r2 }, false);
        }
    }

    // Chapter 3: a heavy star, red supergiant, supernova, remnant and neutron star
    _chapterSupernova(u) {
        const { W, H } = this;
        const cx = W / 2;
        const cy = H * 0.54;
        const boom = 0.45;
        if (u < boom) {
            const grow = smooth((u - 0.15) / 0.27);
            const R = glog(6, 9, u / 0.15) * glog(1, 110, grow);
            const T = glog(28000, 3500, grow);
            this._drawStar(cx, cy, this._radiusPx(R), T, grow > 0.5 ? 9 : grow > 0.05 ? 6 : 3);
        } else {
            const v = (u - boom) / (1 - boom);
            this._drawRemnant(cx, cy, v);
            const f = (u - boom) / 0.12;
            this._blast(cx, cy, this._radiusPx(900), f, false);
            this._drawNeutronStar(cx, cy, 30000, smooth(f / 0.4));
            this._blast(cx, cy, this._radiusPx(900), f, true);
        }
    }
}
