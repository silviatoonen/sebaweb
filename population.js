// population.js – the form and the progress of population.html. The run itself happens in
// pop-worker.js, in the background, so the page stays responsive during long runs.

const BATCH = 1000; // systems per batch (see pop-worker.js)
const $ = (id) => document.getElementById(id);

// a random seed to start with, so two people (or two runs) don't get the same population by accident
$("s").value = 10000 + Math.floor(Math.random() * 2 ** 30);
// (seeds below a few thousand make this build of SeBa crash at the start: a bug in SeBa, see the notes)
$("batch-size").textContent = BATCH.toLocaleString("en");

// the exponent fields only for the power-law distributions
function showExponents() {
    document.querySelectorAll("[data-exp]").forEach((box) => {
        box.hidden = $(box.dataset.exp).value !== box.dataset.show;
    });
}

// the SeBa options from the form (without -R, -n, -N, -s, which the worker adds per batch)
function options() {
    const v = (id) => $(id).value.trim();
    const opt = ["-T", v("T"), "-z", v("z"), "-m", v("m"), "-M", v("M"), "-f", v("f")];
    if (v("f") === "1") opt.push("-x", v("x"));
    opt.push("-q", v("q"), "-Q", v("Q"), "-p", v("p"));
    if (v("p") === "2") opt.push("-w", v("w"));
    opt.push("-a", v("a"), "-A", v("A"), "-g", v("g"));
    if (v("g") === "1") opt.push("-y", v("y"));
    opt.push("-e", v("e"), "-E", v("E"), "-u", v("u"));
    if (v("u") === "1") opt.push("-v", v("v"));
    return opt;
}

function showCommand() {
    $("cmd").textContent = ["SeBa -R -n", $("n").value, "-N", $("N").value, "-s", $("s").value, ...options()].join(" ");
}

// checks before a run; returns a message, or "" when all is fine
function problems() {
    const num = (id) => parseFloat($(id).value);
    for (const el of $("pop-form").querySelectorAll("input[type=number]")) {
        if (el.closest("[hidden]")) continue;
        if (!el.checkValidity() || $(el.id).value.trim() === "") {
            const label = el.closest("div").querySelector("label");
            return `Please check “${label ? label.textContent : el.id}”.`;
        }
    }
    const pairs = [["m", "M", "primary mass"], ["q", "Q", "mass ratio"], ["a", "A", "separation"], ["e", "E", "eccentricity"]];
    for (const [lo, hi, name] of pairs) {
        if (num(lo) > num(hi)) return `The minimum ${name} is larger than the maximum.`;
    }
    if (!Number.isInteger(num("n")) || !Number.isInteger(num("N")) || !Number.isInteger(num("s"))) {
        return "The number of systems, the first ID and the seed must be whole numbers.";
    }
    return "";
}

const fmtBytes = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(0)} kB`);
const fmtTime = (s) => {
    if (!isFinite(s)) return "–";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.round(s % 60);
    return h ? `${h} h ${m} min` : m ? `${m} min ${sec} s` : `${sec} s`;
};

let worker = null;
let wakeLock = null;
let downloadUrl = null;
let lastRun = null;

async function keepAwake(on) {
    try {
        if (on && "wakeLock" in navigator) {
            wakeLock = await navigator.wakeLock.request("screen");
        } else if (!on && wakeLock) {
            await wakeLock.release();
            wakeLock = null;
        }
    } catch (e) {
        // not allowed or not supported: the run works anyway
    }
}
// the screen lock is let go when the tab is hidden; ask again when it comes back
document.addEventListener("visibilitychange", () => {
    if (worker && document.visibilityState === "visible") keepAwake(true);
});

function warnBeforeLeaving(e) {
    e.preventDefault();
    e.returnValue = "";
}

function setRunning(running) {
    $("pop-start").disabled = running;
    $("pop-stop").disabled = !running;
    $("pop-form").querySelectorAll("input, select").forEach((el) => (el.disabled = running));
    if (running) {
        window.addEventListener("beforeunload", warnBeforeLeaving);
    } else {
        window.removeEventListener("beforeunload", warnBeforeLeaving);
    }
    keepAwake(running);
}

function start(e) {
    e.preventDefault();
    const problem = problems();
    $("pop-status").hidden = false;
    if (problem) {
        $("pop-msg").innerHTML = `<span class="pop-warn">${problem}</span>`;
        return;
    }
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    $("pop-download").style.display = "none";
    $("pop-info").hidden = true;
    $("pop-bar").style.width = "0";
    $("pop-numbers").textContent = "";
    $("pop-msg").textContent = "Starting SeBa…";

    const n = parseInt($("n").value, 10);
    const first = parseInt($("N").value, 10);
    const seed = parseInt($("s").value, 10);
    const gzip = $("gzip").checked && "CompressionStream" in self;
    lastRun = { n, first, seed, gzip, options: options(), started: new Date() };

    worker = new Worker("pop-worker.js?v=2", { type: "module" });
    worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === "progress") {
            const frac = m.done / m.n;
            const left = (m.seconds / m.done) * (m.n - m.done);
            $("pop-bar").style.width = `${(100 * frac).toFixed(1)}%`;
            $("pop-msg").textContent = `Running… ${m.done.toLocaleString("en")} of ${m.n.toLocaleString("en")} systems done.`;
            $("pop-numbers").textContent =
                `Time so far ${fmtTime(m.seconds)}, about ${fmtTime(left)} to go. ` +
                `Output ${fmtBytes(m.bytesRaw)}` + (gzip ? ` (${fmtBytes(m.bytesOut)} compressed so far).` : ".");
        } else if (m.type === "done") {
            finish(m);
        } else if (m.type === "error") {
            $("pop-msg").innerHTML = `<span class="pop-warn">The run stopped with an error: ${m.message}</span>`;
            endWorker();
        }
    };
    worker.onerror = (err) => {
        $("pop-msg").innerHTML = `<span class="pop-warn">The run could not start: ${err.message || "unknown error"}.</span>`;
        endWorker();
    };
    setRunning(true);
    const comment =
        `Created with the Star Workshop SeBa population page (population.html) on ${lastRun.started.toISOString()}. ` +
        `Requested ${n} systems from ID ${first}, random seed ${seed} (batch k of ${BATCH} uses seed ${seed} + k). ` +
        `Options: ${options().join(" ")}.`;
    worker.postMessage({ type: "run", args: options(), n, first, seed, batch: BATCH, gzip, comment });
}

function finish(m) {
    const last = lastRun.first + m.done - 1;
    const name = `SeBa_z${$("z").value}_N${lastRun.first}-${last}_s${lastRun.seed}.data${lastRun.gzip ? ".gz" : ""}`;
    lastRun.done = m.done;
    lastRun.seconds = m.seconds;
    lastRun.commands = m.commands;
    lastRun.file = name;
    downloadUrl = URL.createObjectURL(m.blob);
    const a = $("pop-download");
    a.href = downloadUrl;
    a.download = name;
    a.style.display = "inline-block";
    $("pop-info").hidden = false;
    $("pop-bar").style.width = `${((100 * m.done) / lastRun.n).toFixed(1)}%`;
    $("pop-msg").textContent = m.failed
        ? `${m.failed}. The ${m.done.toLocaleString("en")} systems before it (IDs ${lastRun.first}–${last}) are fine and can be downloaded.`
        : m.stopped
        ? `Stopped after ${m.done.toLocaleString("en")} systems (IDs ${lastRun.first}–${last}). You can download what was done so far.`
        : `Done: ${m.done.toLocaleString("en")} systems (IDs ${lastRun.first}–${last}).`;
    $("pop-numbers").textContent =
        `Run time ${fmtTime(m.seconds)}. File ${fmtBytes(m.bytesOut)}` + (lastRun.gzip ? ` (${fmtBytes(m.bytesRaw)} uncompressed).` : ".");
    endWorker();
}

function endWorker() {
    if (worker) worker.terminate();
    worker = null;
    setRunning(false);
}

// a small text file with everything needed to repeat or stitch this run
function downloadInfo() {
    if (!lastRun) return;
    const lines = [
        "SeBa population run (Star Workshop, population.html)",
        `date: ${lastRun.started.toISOString()}`,
        `data file: ${lastRun.file}`,
        `systems: ${lastRun.done} (IDs ${lastRun.first} to ${lastRun.first + lastRun.done - 1})`,
        `random seed: ${lastRun.seed} (batch k of ${BATCH} systems uses seed ${lastRun.seed} + k)`,
        `run time: ${fmtTime(lastRun.seconds)}`,
        "",
        "SeBa commands, one per batch:",
        ...lastRun.commands,
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = lastRun.file.replace(/\.data(\.gz)?$/, "_info.txt");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("pop-form").addEventListener("submit", start);
$("pop-stop").addEventListener("click", () => {
    if (worker) {
        worker.postMessage({ type: "stop" });
        $("pop-msg").textContent = "Stopping after the current batch…";
    }
});
$("pop-info").addEventListener("click", downloadInfo);
$("pop-form").addEventListener("input", () => {
    showExponents();
    showCommand();
});
showExponents();
showCommand();
