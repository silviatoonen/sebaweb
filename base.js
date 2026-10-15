// SeBa online – base.js, version 18 (language buttons, no theme switch, star movie)
// Both simulators use the SeBa build with the finer time output ("hirestime"): it gives the same
// physics as the default build, but many more rows, so the graphs, the table and the movie are smoother.
// (The single-star simulator runs it as a binary with a very wide orbit and a light companion.)
import createSeBaHires from "./seba_hirestime.js";
import * as C_S from "./constants-single.js";
import * as C_B from "./constants-binary.js?v=2";

const params = new URLSearchParams(window.location.search);
const VARIANT = params.get("variant");
const DEBUG = params.get("debug") == "debug";

const CONST = VARIANT == "single" ? C_S : C_B;
const createSeBa = createSeBaHires;

/* Physics constants */
const SIGMA_SB = 5.670374419e-8;
const R_SUN = 695.7e6;
const L_SUN = 3.828e26;

const FALLBACK_LANG = "en";
// Give the user some milliseconds to update a value before
// running SeBa again
const INPUTTIMEOUT = 500;
// all data fields output by SeBa in `seba.data`

const GRAPHDEFAULTS = {
    x: "time",
    y: VARIANT == "single" ? "radius" : "mass1",
};

const GRAPH_SCALES = {
    linlin: ["linear", "linear"],
    linlog: ["linear", "log"],
    loglin: ["log", "linear"],
    loglog: ["log", "log"],
};

const PLOTLY_DARK_MODE = {
    paper_bgcolor: "#141c33",
    plot_bgcolor: "#0c1224",
    font: { family: "Instrument Sans, system-ui, sans-serif", color: "#e8ecf5" },
    xaxis: { color: "#e8ecf5", gridcolor: "#26314d", zerolinecolor: "#34436b" },
    yaxis: { color: "#e8ecf5", gridcolor: "#26314d", zerolinecolor: "#34436b" },
};

const PLOTLY_LIGHT_MODE = {
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#f5f7fa",
    font: { family: "Instrument Sans, system-ui, sans-serif", color: "#14213d" },
    xaxis: { color: "#14213d", gridcolor: "#dbe1ea", zerolinecolor: "#b9c6e4" },
    yaxis: { color: "#14213d", gridcolor: "#dbe1ea", zerolinecolor: "#b9c6e4" },
};

// Supported languages with a translation file
const LANGUAGES = ["en", "nl"];
const DEFAULT_LANG = "nl";

const stdoutElem = $q("#program-log output");

// Collect output lines in memory as well
const stdoutLines = [];

function $id(idspec) {
    return document.getElementById(idspec);
}

function $q(selector) {
    return document.querySelector(selector);
}

function $qa(selector) {
    return document.querySelectorAll(selector);
}

function $create(element) {
    return document.createElement(element);
}

let translations = {};
let fileContent = "";
let data = {};
let rawTypes = {}; // the stellar types as numbers, before translateTypes() turns them into text
let movie = null; // the star movie (single-star simulator only)

// The columns of the table: in the binary simulator the type of mass transfer comes second
function tableFields() {
    const fields = CONST.USERDATAFIELDS.filter((f) => f !== "transfertype");
    if (VARIANT != "single") {
        fields.splice(1, 0, "transfertype");
    }
    return fields;
}

function updateTableHeader() {
    const lang = document.documentElement.lang;
    const translation = translations[lang];
    let ths = [];
    for (const col of tableFields()) {
        const key = `${col}-field`;
        const th = $create("th");
        let name = "";
        if (key in translation) {
            name = translation[key];
        } else {
            // Fall back to the default language
            name = translations[FALLBACK_LANG][key];
        }
        if (!name) {
            // Fall back to the base column identifier
            name = col;
        }
        th.textContent = name;
        ths.push(th);
    }
    var row = $q("#data-table thead tr");
    row.replaceChildren(...ths);
}

// Helper to append a line to the stdout display
// stderr is combined with stdout
function appendOutput(text) {
    stdoutLines.push(text);
    stdoutElem.textContent = stdoutLines.join("\n");
}

function createControls() {
    let updateTimeout = null; // Keeps track of input waiting time

    const template = $q("#control-template");
    for (const name of CONST.CONTROL_ORDER) {
        const control = CONST.CONTROLS[name];
        const clone = document.importNode(template.content, true);

        let div = clone.querySelector("div");
        div.id = `${name}-control`;
        let tooltip = div.querySelector("div");
        tooltip.id = `${name}-tooltip`;
        let tooltiptext = tooltip.querySelector("span");
        tooltiptext.dataset.i8n = `${name}-tooltip`;

        let label = clone.querySelector("label");
        label.name = name;
        label.htmlFor = `${name}-input`;
        //label.dataset.i8n = `${name}-label`;
        label.innerHTML = `
            <span data-i8n="${name}-name"></span>
            (<span id="${name}-min-value"></span> &ndash;
             <span id="${name}-max-value"></span>)</label>`;
        let input = clone.querySelector("input[type=number]");
        input.id = `${name}-input`;
        input.min = control["min"];
        input.max = control["max"];
        input.value = control["value"];
        //input.step = control["step"];
        input.dataset.prec = control["prec"];
        input.dataset.range = name;

        let slider = clone.querySelector("input[type=range]");
        slider.id = `${name}-range`;
        if (control["log"]) {
            slider.min = Math.log10(control["min"]);
            slider.max = Math.log10(control["max"]);
            slider.value = Math.log10(control["value"]);
        } else {
            slider.min = control["min"];
            slider.max = control["max"];
            slider.value = control["value"];
        }
        slider.dataset.input = name;

        slider.addEventListener("input", function (evt) {
            updateFromSlider(this);
            clearTimeout(updateTimeout);
            if ($id("direct-update").checked) {
                updateTimeout = setTimeout(() => {
                    runSeba();
                }, INPUTTIMEOUT);
            }
        });

        input.addEventListener("blur", (event) => clampValue(event.target));
        input.addEventListener("input", function (evt) {
            updateFromInput(this);
            clearTimeout(updateTimeout);
            if ($id("direct-update").checked) {
                updateTimeout = setTimeout(() => {
                    runSeba();
                }, INPUTTIMEOUT);
            }
        });

        const form = $q("#controls form");
        form.appendChild(clone);
    }
}

// ===== the companion in the binary simulator: a star or a planet =====
// SeBa also follows planets. For a planet the mass is given in Earth masses
// (0.05 Earth masses to 100 Jupiter masses) and passed on to SeBa in solar masses.
const EARTH_MASS = 1 / 332946; // one Earth mass, in solar masses
const JUPITER_MASS = 317.83; // one Jupiter mass, in Earth masses
const COMPANION = {
    star: null, // filled in with the values from constants-binary.js
    planet: { min: 0.05, max: 100 * JUPITER_MASS, value: 1, step: 0.01, prec: 2, log: true },
};
let companion = "star";

function createCompanionSwitch() {
    const ctl = $id("mass2-control");
    if (!ctl) {
        return;
    }
    COMPANION.star = { ...CONST.CONTROLS.mass2 };
    const box = $create("div");
    box.className = "companion";
    box.id = "companion-switch";
    box.innerHTML = `<span class="companion-label" data-i8n="companion-label"></span>
        <div class="seg" role="group">
          <button type="button" data-companion="star" aria-pressed="true" data-i8n="companion-star"></button>
          <button type="button" data-companion="planet" aria-pressed="false" data-i8n="companion-planet"></button>
        </div>`;
    ctl.prepend(box); // at the top of the card of the mass of star 2
    box.querySelectorAll("button").forEach((button) =>
        button.addEventListener("click", () => setCompanion(button.dataset.companion, true)),
    );
    // for a planet: the mass in Jupiter masses as well
    const hint = $create("p");
    hint.id = "mass2-hint";
    hint.className = "unit-hint";
    hint.hidden = true;
    ctl.append(hint);
    $id("mass2-input").addEventListener("input", updateMass2Hint);
    $id("mass2-range").addEventListener("input", updateMass2Hint);
}

function setCompanion(kind, run = false) {
    if (!(kind in COMPANION) || !COMPANION.star) {
        return;
    }
    const input = $id("mass2-input");
    const slider = $id("mass2-range");
    // remember the value that was chosen, for when you switch back
    const now = parseFloat(input.value);
    if (!isNaN(now)) {
        COMPANION[companion].value = now;
    }
    companion = kind;
    const c = COMPANION[kind];
    Object.assign(CONST.CONTROLS.mass2, c);
    input.min = c.min;
    input.max = c.max;
    input.dataset.prec = c.prec;
    input.value = c.value;
    slider.min = Math.log10(c.min);
    slider.max = Math.log10(c.max);
    slider.value = Math.log10(c.value);
    const planet = kind === "planet";
    const name = $q("#mass2-control label [data-i8n]");
    name.dataset.i8n = planet ? "mass2p-name" : "mass2-name";
    name.innerHTML = _t(name.dataset.i8n);
    const tip = $q("#mass2-tooltip span");
    tip.dataset.i8n = planet ? "mass2p-tooltip" : "mass2-tooltip";
    tip.innerHTML = _t(tip.dataset.i8n);
    $id("mass2-min-value").textContent = planet ? `0.05 ${_t("earth-short")}` : c.min;
    $id("mass2-max-value").textContent = planet ? `100 ${_t("jupiter-short")}` : c.max;
    document.querySelectorAll("#companion-switch button").forEach((button) =>
        button.setAttribute("aria-pressed", button.dataset.companion === kind ? "true" : "false"),
    );
    updateMass2Hint();
    updateSepHint();
    if (run && $id("direct-update").checked) {
        runSeba();
    }
}

function updateMass2Hint() {
    const hint = $id("mass2-hint");
    if (!hint) {
        return;
    }
    hint.hidden = companion !== "planet";
    const v = parseFloat($id("mass2-input").value);
    if (companion === "planet" && !isNaN(v)) {
        const lang = document.documentElement.lang === "en" ? "en" : "nl";
        const mj = (v / JUPITER_MASS).toLocaleString(lang, { maximumSignificantDigits: 2 });
        hint.textContent = `≈ ${mj} ${_t("jupiter-masses")}`;
    }
}

// The mass of star 2 as SeBa wants it: in solar masses
function mass2ForSeba() {
    const value = $id("mass2-input").value.trim();
    if (companion !== "planet") {
        return value;
    }
    return String(parseFloat(value) * EARTH_MASS);
}

// ===== the orbit in the binary simulator: give the separation or the orbital period =====
// The period (in days) is turned into a separation with Kepler's third law, using the two masses:
// a [AU] = (P [yr]^2 * (M1 + M2))^(1/3), with 1 AU = 215.032 solar radii.
const ORBIT = {
    sep: null, // filled in with the values from constants-binary.js
    period: { min: 0.01, max: 1e7, value: 100, step: 0.01, prec: 2, log: true },
};
let orbitMode = "sep";

function totalMass() {
    const m1 = parseFloat($id("mass1-input").value);
    let m2 = parseFloat($id("mass2-input").value);
    if (companion === "planet") {
        m2 *= EARTH_MASS;
    }
    return (m1 > 0 ? m1 : 0) + (m2 > 0 ? m2 : 0);
}
const periodFromSep = (a, M) => 365.25 * Math.sqrt((a / 215.032) ** 3 / M);
const sepFromPeriod = (P, M) => 215.032 * ((P / 365.25) ** 2 * M) ** (1 / 3);

function createOrbitSwitch() {
    const ctl = $id("sep-control");
    if (!ctl) {
        return;
    }
    ORBIT.sep = { ...CONST.CONTROLS.sep };
    const box = $create("div");
    box.className = "companion";
    box.id = "orbit-switch";
    box.innerHTML = `<span class="companion-label" data-i8n="orbit-label"></span>
        <div class="seg" role="group">
          <button type="button" data-orbit="sep" aria-pressed="true" data-i8n="orbit-sep"></button>
          <button type="button" data-orbit="period" aria-pressed="false" data-i8n="orbit-period"></button>
        </div>`;
    ctl.prepend(box);
    box.querySelectorAll("button").forEach((button) =>
        button.addEventListener("click", () => setOrbitMode(button.dataset.orbit, true)),
    );
    // in period mode: the separation that goes with it
    const hint = $create("p");
    hint.id = "sep-hint";
    hint.className = "unit-hint";
    hint.hidden = true;
    ctl.append(hint);
    for (const id of ["sep", "mass1", "mass2"]) {
        $id(`${id}-input`).addEventListener("input", updateSepHint);
        $id(`${id}-range`).addEventListener("input", updateSepHint);
    }
}

function setOrbitMode(kind, run = false) {
    if (!(kind in ORBIT) || !ORBIT.sep || kind === orbitMode) {
        return;
    }
    const input = $id("sep-input");
    const slider = $id("sep-range");
    // keep the same orbit: turn the separation into a period, or the other way round
    const now = parseFloat(input.value);
    const M = totalMass();
    const c = ORBIT[kind];
    let value = c.value;
    if (!isNaN(now) && M > 0) {
        value = kind === "period" ? periodFromSep(now, M) : sepFromPeriod(now, M);
    }
    value = Math.min(c.max, Math.max(c.min, value));
    orbitMode = kind;
    Object.assign(CONST.CONTROLS.sep, c);
    input.min = c.min;
    input.max = c.max;
    input.dataset.prec = c.prec;
    input.value = value.toFixed(c.prec);
    slider.min = Math.log10(c.min);
    slider.max = Math.log10(c.max);
    slider.value = Math.log10(value);
    const period = kind === "period";
    const name = $q("#sep-control label [data-i8n]");
    name.dataset.i8n = period ? "periodin-name" : "sep-name";
    name.innerHTML = _t(name.dataset.i8n);
    const tip = $q("#sep-tooltip span");
    tip.dataset.i8n = period ? "periodin-tooltip" : "sep-tooltip";
    tip.innerHTML = _t(tip.dataset.i8n);
    $id("sep-min-value").textContent = c.min;
    $id("sep-max-value").textContent = c.max;
    document.querySelectorAll("#orbit-switch button").forEach((button) =>
        button.setAttribute("aria-pressed", button.dataset.orbit === kind ? "true" : "false"),
    );
    updateSepHint();
    if (run && $id("direct-update").checked) {
        runSeba();
    }
}

function updateSepHint() {
    const hint = $id("sep-hint");
    if (!hint) {
        return;
    }
    hint.hidden = orbitMode !== "period";
    const P = parseFloat($id("sep-input").value);
    const M = totalMass();
    if (orbitMode === "period" && P > 0 && M > 0) {
        const lang = document.documentElement.lang === "en" ? "en" : "nl";
        const a = sepFromPeriod(P, M).toLocaleString(lang, { maximumSignificantDigits: 3 });
        hint.textContent = `≈ ${a} ${_t("unit-sep")} ${_t("orbit-hint")}`;
    }
}

// The separation as SeBa wants it: in solar radii
function sepForSeba() {
    const value = $id("sep-input").value.trim();
    if (orbitMode !== "period") {
        return value;
    }
    return String(sepFromPeriod(parseFloat(value), totalMass()));
}

function updateMinMax() {
    for (const label of $qa("form#user-input label")) {
        const name = label.name;
        let values = [];
        const control = CONST.CONTROLS[name];
        values = { min: control["min"], max: control["max"] };
        if (!values) {
            console.warn("Missing min-max values for ", name);
            return;
        }
        let minval = label.querySelector(`#${name}-min-value`);
        minval.textContent = values["min"];
        let maxval = label.querySelector(`#${name}-max-value`);
        maxval.textContent = values["max"];
    }
}

async function loadTranslations() {
    for (const lang of LANGUAGES) {
        try {
            const response = await fetch(`${lang}.json?v=5`); // ?v: load the new texts after a change

            if (!response.ok) {
                throw new Error(`Could not fetch ${lang}.json`);
            }
            translations[lang] = await response.json();
        } catch (error) {
            console.error("Translation error:", error);
        }
    }
}

function updatePlotOptions() {
    for (const name of ["x", "y"]) {
        let axis = $id(`${name}-axis`);
        let selection = axis.value;
        if (!axis.value) {
            selection = GRAPHDEFAULTS[name];
        }
        let options = [];
        for (const field of CONST.USERDATAFIELDS) {
            let option = $create("option");
            option.value = field;
            option.textContent = _t(`${field}-field`);
            if (field == selection) {
                option.selected = true;
            }
            options.push(option);
        }
        axis.replaceChildren(...options);
    }
}

// Show only the labels (menu, footer) written for the chosen language,
// and mark the active language button
function setLabels(lang) {
    document.querySelectorAll("[data-l]").forEach((element) => {
        element.hidden = element.dataset.l !== lang;
    });
    document.querySelectorAll(".lang button").forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.lang === lang ? "true" : "false");
    });
}

function switchLang(lang) {
    document.documentElement.lang = lang;
    if (!(lang in translations)) {
        lang = FALLBACK_LANG;
    }
    localStorage.setItem("lang", lang);
    setLabels(lang);
    const translation = translations[lang];
    const elements = document.querySelectorAll("[data-i8n]");
    for (const element of elements) {
        const key = element.dataset.i8n;
        if (key in translation) {
            let string = translation[key];
            if (Array.isArray(string)) {
                string = string.join("");
            }
            element.innerHTML = string;
        } else {
            let string = translations[FALLBACK_LANG][key];
            if (Array.isArray(string)) {
                string = string.join("");
            }
            console.log(
                `falling back to default translation for ${key} = ${string}`,
            );
            element.innerHTML = string;
        }
    }

    if (Object.keys(data).length) {
        // Re-read the data, so we can perform the translation from
        // type numbers to text again
        // Note that the SeBa.data file does not need to be run again
        readData();
        populateTable();
    }

    updateTableHeader();
    updatePlotOptions();
    if (Object.keys(data).length) {
        plot();
    }
    if (movie) {
        movie.refreshLabels();
    }
    updateMass2Hint();
    updateSepHint();
    document.title = _t("seba-main-title") || document.title;
}

function updateFromSlider(slider) {
    const id = `${slider.dataset.input}`;
    let input = $id(`${id}-input`);
    const control = CONST.CONTROLS[id];
    const actualValue = control["log"]
        ? 10 ** parseFloat(slider.value)
        : parseFloat(slider.value);

    input.value = actualValue.toFixed(parseInt(input.dataset.prec));
}

// Convert actual value back to slider position (log10)
function updateFromInput(input) {
    const id = `${input.dataset.range}`;
    const slider = $id(`${id}-range`);
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    let value = parseFloat(input.value);
    if (isNaN(value)) {
        return;
    }

    if (value < min) {
        value = min;
    } else if (value > max) {
        value = max;
    }

    const control = CONST.CONTROLS[id];
    if (control["log"] && value > 0) {
        slider.value = Math.log10(value);
    } else {
        slider.value = value;
    }
}

function clampValue(input) {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    let value = parseFloat(input.value);

    if (isNaN(value)) {
        input.value = min; // Default to min if input is empty/invalid
        updateFromInput(input);
        return;
    }

    if (value < min) {
        input.value = min;
    } else if (value > max) {
        input.value = max;
    }
}

// function to translate strings in JavaScript code
function _t(key) {
    let lang = document.documentElement.lang;
    if (!(lang in translations)) {
        lang = FALLBACK_LANG;
    }
    const translation = translations[lang];
    let string = "";
    if (!(key in translation)) {
        string = translations[FALLBACK_LANG][key];
    } else {
        string = translation[key];
    }
    if (Array.isArray(string)) {
        string = string.join("");
    }
    if (!string) {
        string = "";
    }
    return string;
}

// The star movie: draws the result of a single-star run as an animation (see star-movie.js)
async function initMovie() {
    try {
        const { StarMovie, BinaryMovie } = await import("./star-movie.js?v=27");
        // show the movie area first, so that the canvas can measure its size
        $id("star-movie").classList.replace("invisible", "visible");
        $id("gif-space").classList.add("invisible");
        const Movie = VARIANT == "single" ? StarMovie : BinaryMovie;
        movie = new Movie({
            canvas: $id("star-canvas"),
            playButton: $id("movie-play"),
            replayButton: $id("movie-replay"),
            slider: $id("movie-slider"),
            speedSelect: $id("movie-speed"),
            downloadButton: $id("movie-download"),
            onState: scheduleDot,
            t: _t,
            // the photo of the Crab Nebula is optional; when it is there, show who made it
            onCrabLoaded: () => $id("movie-credit").classList.replace("invisible", "visible"),
            // the same for the photo of the Helix Nebula (only used in the binary movie)
            onHelixLoaded: () => {
                if (VARIANT != "single" && $id("movie-credit-helix")) {
                    $id("movie-credit-helix").classList.replace("invisible", "visible");
                }
            },
        });
        updateMovie();
    } catch (error) {
        console.warn("The movie is not available:", error);
    }
}

function movieRows() {
    if (VARIANT != "single") {
        return {
            time: data["time"],
            sep: data["sep"],
            ecc: data["ecc"],
            bintype: rawTypes["bintype"],
            tt: rawTypes["transfertype"],
            m1: data["mass1"],
            r1: data["radius1"],
            T1: data["efftemp1"],
            ty1: rawTypes["type1"],
            m2: data["mass2"],
            r2: data["radius2"],
            T2: data["efftemp2"],
            ty2: rawTypes["type2"],
        };
    }
    const pick = (a, b) => data[a] ?? data[b];
    return {
        time: data["time"],
        radius: pick("radius", "radius1"),
        teff: pick("efftemp", "efftemp1"),
        mass: pick("mass", "mass1"),
        type: rawTypes["type"] ?? rawTypes["type1"],
    };
}

// (Re)make the movie from the data of the latest run
function updateMovie() {
    if (movie && Object.keys(data).length) {
        movie.load(movieRows());
    }
}

// Run SeBa
async function runSeba() {
    $id("start-button").disabled = true;
    const Module = await createSeBa({
        print: (text) => appendOutput(text),
        printErr: (text) => appendOutput(text),
    });

    if (!Module || !Module.callMain) {
        alert("Module not initialized yet.");
        return;
    }

    // Clear previous output
    stdoutLines.length = 0;
    stdoutElem.textContent = "";

    const args =
        VARIANT == "single"
            ? [
                  "-M",
                  $id("mass-input").value.trim(),
                  "-m",
                  CONST.DEFAULT_PARAMS["mass2"],
                  "-e",
                  CONST.DEFAULT_PARAMS["ecc"],
                  "-a",
                  CONST.DEFAULT_PARAMS["sep"],
                  "-T",
                  $id("time-input").value.trim(),
                  "-z",
                  $id("metal-input").value.trim(),
              ]
            : [
                  "-M",
                  $id("mass1-input").value.trim(),
                  "-m",
                  mass2ForSeba(),
                  "-e",
                  $id("ecc-input").value.trim(),
                  "-a",
                  sepForSeba(),
                  "-T",
                  $id("time-input").value.trim(),
                  "-z",
                  $id("metal-input").value.trim(),
              ];
    // Remove previous SeBa.data if it exists
    try {
        Module.FS.unlink("SeBa.data");
    } catch (error) {
        // Ignore if file did not exist
        if (error.errno != 44) {
            // 44 appears
            console.error(
                "Error when attempting to remove 'SeBa.data': ",
                error,
            );
        }
    }

    // Call main(argc, argv) via callMain
    try {
        Module.callMain(args);
    } catch (e) {
        appendOutput("Exception: " + e, true);
        console.error("EXCEPTION: ", e);
    }

    // After main returns, try to read output.txt
    try {
        fileContent = Module.FS.readFile("SeBa.data", { encoding: "utf8" });
        readData();

        $id("download-data").disabled = false;
        $id("download-data-excel").disabled = false;
        // Enable graph options
        $id("graph-style").disabled = false;
        $id("x-axis").disabled = false;
        $id("y-axis").disabled = false;
        populateTable();
        plot();
        updateMovie();
    } catch (error) {
        appendOutput(`Could not read SeBa.data: ${error}`, true);
    }

    // Reset the start button and status field
    $id("start-button").disabled = false;
    $id("status").textContent = "";
}

// "Translate" the stellar and binary types from numbers to text
function translateTypes() {
    CONST.DATAFIELDS.forEach((name) => {
        if (name.startsWith("type")) {
            for (let index in data[name]) {
                const value = data[name][index];
                const key = `type-${value}`;
                data[name][index] = _t(key);
            }
        }
        if (name === "transfertype") {
            for (let index in data[name]) {
                const value = data[name][index];
                data[name][index] = _t(`transfertype-${value}`) || value;
            }
        }
        if (name === "bintype") {
            for (let index in data[name]) {
                const value = data[name][index];
                const key = `bintype-${value}`;
                data[name][index] = _t(key);
            }
        }
    });
}

function readData() {
    const length = CONST.DATAFIELDS.length;
    var array = Array.from({ length: length }, (_) => []);
    const lines = fileContent.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        const cols = trimmed.split(/\s+/);
        cols.forEach((value, i) => array[i].push(parseFloat(value)));
    }

    /* Convert the columns to named columns */
    data = {};
    CONST.DATAFIELDS.forEach((name, index) => {
        data[name] = array[index];
    });

    rawTypes = {};
    CONST.DATAFIELDS.forEach((name) => {
        if (name.startsWith("type") || name === "bintype" || name === "transfertype") {
            rawTypes[name] = data[name].slice();
        }
    });

    translateTypes(); // translate the *type columns

    // Add luminosity as a derived column
    let efftemp = "efftemp";
    let radius = "radius";
    let lum = "lum";
    if (VARIANT != "single") {
        efftemp += "1";
        radius += "1";
        lum += "1";
    }
    data[efftemp] = data[efftemp].map((value) => 10 ** value);
    data[lum] = data[radius].map(
        (item, i) =>
            (4 *
                Math.PI *
                SIGMA_SB *
                (item * R_SUN) ** 2 *
                data[efftemp][i] ** 4) /
            L_SUN,
    );
    // Star 2 remains the same; it's simply ignored for single evolution
    data["efftemp2"] = data["efftemp2"].map((value) => 10 ** value);
    data["lum2"] = data["radius2"].map(
        (item, i) =>
            (4 *
                Math.PI *
                SIGMA_SB *
                (item * R_SUN) ** 2 *
                data["efftemp2"][i] ** 4) /
            L_SUN,
    );

    // Binary: the orbital period in days, from the separation and the two masses (Kepler's third law:
    // P in years = sqrt(a^3 / M) with a in AU and M in solar masses; 1 AU = 215.032 solar radii).
    // After a merger (separation 0) the period is 0 as well.
    if (VARIANT != "single") {
        data["period"] = data["sep"].map((a, i) => {
            const M = data["mass1"][i] + data["mass2"][i];
            if (!(a > 0) || !(M > 0)) {
                return 0;
            }
            return Number((365.25 * Math.sqrt((a / 215.032) ** 3 / M)).toPrecision(5));
        });
    }
}

function populateTable() {
    let trs = [];
    for (let rownr = 0; rownr < data[CONST.USERDATAFIELDS[0]].length; ++rownr) {
        let tr = $create("tr");
        for (const col of tableFields()) {
            const td = $create("td");
            td.textContent = data[col][rownr];
            tr.appendChild(td);
        }
        trs.push(tr);
    }
    let tbody = $q("#data-table tbody");
    tbody.replaceChildren(...trs);
}

// ===== graph: start =====
const GRAPH_CONFIG = { responsive: true, displaylogo: false };

// One colour per phase of the star: the line in the graph changes colour with the phase
const PHASE_COLORS = {
    3: "#5aa8ff", // main sequence
    5: "#ffd36b", // Hertzsprung gap
    6: "#f2b134", // first giant branch
    7: "#ff9a62", // core helium burning
    8: "#ff5f56", // asymptotic giant branch
    9: "#ff5f56",
    10: "#7fe0ff", // helium star
    11: "#ff7aa8", // helium giant
    12: "#c8d6ff", // white dwarfs
    13: "#9fb4ff",
    14: "#b9a8ff",
    18: "#b48cff", // neutron star
    19: "#9aa0b5", // black hole
};

// Ready-made graphs (single-star simulator)
const GRAPH_PRESETS = {
    radius: { x: "time", y: "radius", style: "loglog" },
    hr: { x: "efftemp", y: "lum", style: "loglog" }, // Hertzsprung-Russell diagram
    mass: { x: "time", y: "mass", style: "loglin" },
};

// Ready-made graphs (binary simulator)
const GRAPH_PRESETS_BINARY = {
    mass1: { x: "time", y: "mass1", style: "loglin" },
    radius1: { x: "time", y: "radius1", style: "loglog" },
    sep: { x: "time", y: "sep", style: "loglog" },
    period: { x: "time", y: "period", style: "loglog" },
    hr1: { x: "efftemp1", y: "lum1", style: "loglog" },
};

let currentAxes = null; // what is on the axes of the graph that is shown
let dotIndex = -1; // which trace is the white dot that follows the movie
let dotTimer = null;
let lastMovieState = null;

function graphTheme(light) {
    if (light) {
        return PLOTLY_LIGHT_MODE;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? PLOTLY_DARK_MODE
        : PLOTLY_LIGHT_MODE;
}

// Name and unit of a data column, for the axis titles and the hover text.
// "mass1" -> { name: "Mass star 1", unit: "solar masses", title: "Mass star 1 (solar masses)" }
function axisInfo(field) {
    const m = field.match(/^([a-z]+)([12])?$/);
    const base = m ? m[1] : field;
    const star = m && m[2] ? ` ${_t("axis-star")} ${m[2]}` : "";
    const name = _t(`axis-name-${base}`);
    if (!name) {
        const fallback = _t(`${field}-field`) || field;
        return { name: fallback, unit: "", title: fallback };
    }
    const unit = _t(`unit-${base}`);
    return {
        name: name + star,
        unit,
        title: unit ? `${name}${star} (${unit})` : name + star,
    };
}

// The traces and the layout of the graph. `light` makes the light version
// (used for the download), `forExport` leaves out the white dot.
function buildGraph(options = {}) {
    const light = !!options.light;
    const forExport = !!options.forExport;
    let xaxis = $id("x-axis").value;
    let yaxis = $id("y-axis").value;
    if (!(xaxis in data)) {
        xaxis = GRAPHDEFAULTS["x"];
    }
    if (!(yaxis in data)) {
        yaxis = GRAPHDEFAULTS["y"];
    }
    const [xtype, ytype] = GRAPH_SCALES[$id("graph-style").value] ?? ["log", "log"];
    const theme = graphTheme(light);
    const dark = theme === PLOTLY_DARK_MODE;
    const single = VARIANT == "single";
    const xi = axisInfo(xaxis);
    const yi = axisInfo(yaxis);
    const hover = (withPhase) =>
        (withPhase ? "<b>%{customdata}</b><br>" : "") +
        `${xi.name}: %{x:.4g} ${xi.unit}<br>${yi.name}: %{y:.4g} ${yi.unit}<extra></extra>`;

    const xs = data[xaxis];
    const ys = data[yaxis];
    const baseColor = dark ? "#3dc1b2" : "#1f9d8f";
    // single star: one colour per phase of the star; binary: one colour per kind of interaction
    const BIN_COLORS = { 0: baseColor, 3: "#ff9a62", 4: "#ff5f56", 7: "#ff7aa8", 8: "#9aa0b5", 9: "#b48cff" };
    // binary: no interaction, stable mass transfer (3) or unstable mass transfer (4), merger, ...
    const raw = single ? rawTypes["type"] : rawTypes["bintype"];
    const tts = rawTypes["transfertype"];
    // SeBa binary types: 2 detached, 3 semi-detached, 4 contact, 5 CE (gamma), 6 double spiral-in, 7 merged,
    // 8 disrupted, 9 CE (alpha); mass transfer types 4 and 5 are unstable (common envelope)
    const unstableAt = (v, i) => v === 5 || v === 6 || v === 9 || (tts && (tts[i] === 4 || tts[i] === 5));
    const group = (v, i) => (single ? v : v <= 2 ? 0 : v <= 6 || v === 9 ? (unstableAt(v, i) ? 4 : 3) : v);
    const nameOf = (g) =>
        single ? _t(`type-${g}`) : g === 0 ? _t("transfertype-0") : g === 3 ? _t("transfertype-1") : g === 4 ? _t("transfertype-4") : _t(`bintype-${g}`);
    const colorOf = (g) => (single ? PHASE_COLORS[g] : BIN_COLORS[g]) ?? baseColor;
    const types = raw ? raw.map((v, i) => group(v, i)) : null;
    const traces = [];
    if (types && types.length === xs.length) {
        // one coloured piece for every phase; the pieces share an end point, so the line has no gaps
        const seen = new Set();
        let start = 0;
        for (let i = 1; i <= types.length; i++) {
            if (i < types.length && types[i] === types[start]) {
                continue;
            }
            const type = types[start];
            const from = start > 0 ? start - 1 : 0;
            const name = nameOf(type);
            traces.push({
                x: xs.slice(from, i),
                y: ys.slice(from, i),
                type: "scatter",
                mode: "lines",
                name,
                legendgroup: String(type),
                // unstable mass transfer gets its legend entry from the red circles below
                showlegend: !seen.has(type) && !(!single && type === 4),
                customdata: new Array(i - from).fill(name),
                line: { color: colorOf(type), width: 2.5 },
                hovertemplate: hover(true),
            });
            seen.add(type);
            start = i;
        }
        // Unstable mass transfer (common envelope) happens in one go: in the output it is a single moment,
        // so as a piece of line it would be invisible. It is shown as a red circle at each such moment.
        if (!single) {
            const idx = types.map((g, i) => (g === 4 ? i : -1)).filter((i) => i >= 0);
            if (idx.length) {
                const name = nameOf(4);
                traces.push({
                    x: idx.map((i) => xs[i]),
                    y: idx.map((i) => ys[i]),
                    type: "scatter",
                    mode: "markers",
                    name,
                    legendgroup: "4",
                    showlegend: true,
                    customdata: idx.map(() => name),
                    marker: { size: 10, color: BIN_COLORS[4], line: { color: dark ? "#0c1224" : "#ffffff", width: 1.5 } },
                    hovertemplate: hover(true),
                });
            }
        }
    } else {
        traces.push({
            x: xs,
            y: ys,
            type: "scatter",
            mode: "lines",
            showlegend: false,
            line: { color: baseColor, width: 2.5 },
            hovertemplate: hover(false),
        });
    }
    let dot = -1;
    if (!forExport) {
        traces.push({
            x: [null],
            y: [null],
            type: "scatter",
            mode: "markers",
            showlegend: false,
            hoverinfo: "skip",
            marker: {
                size: 13,
                color: "#ffffff",
                line: { color: dark ? "#0c1224" : "#14213d", width: 2 },
            },
        });
        dot = traces.length - 1;
    }

    // the temperature axis of a Hertzsprung-Russell diagram runs from hot to cool
    const reverseX = xaxis === "efftemp" || xaxis === "efftemp1";
    const layout = {
        ...theme,
        height: options.height ?? 480,
        margin: { l: 70, r: 20, t: 50, b: 60 },
        xaxis: {
            type: xtype,
            autorange: reverseX ? "reversed" : true,
            title: { text: xi.title, standoff: 8 },
            automargin: true,
            ...theme.xaxis,
        },
        yaxis: {
            type: ytype,
            autorange: true,
            title: { text: yi.title, standoff: 8 },
            automargin: true,
            ...theme.yaxis,
        },
        showlegend: !!types,
        legend: { orientation: "h", x: 0, y: 1.12, font: { size: 12 } },
        hovermode: "closest",
    };
    if (forExport) {
        layout.annotations = [
            {
                text: _t("seba-main-title"),
                xref: "container",
                yref: "container",
                x: 0.99,
                y: 0.01,
                xanchor: "right",
                yanchor: "bottom",
                showarrow: false,
                font: { size: 11, color: "#7a8399" },
            },
        ];
    }
    return { traces, layout, xaxis, yaxis, xtype, ytype, dotIndex: dot };
}

function plot() {
    const g = buildGraph();
    currentAxes = { x: g.xaxis, y: g.yaxis, xtype: g.xtype, ytype: g.ytype };
    dotIndex = g.dotIndex;
    $id("download-graph").disabled = false;
    Plotly.newPlot("plotly-graph", g.traces, g.layout, GRAPH_CONFIG).then(moveDot);
}

// The movie reports where the star is; the dot in the graph follows (a few times per second)
function scheduleDot(state) {
    lastMovieState = state;
    if (dotTimer === null) {
        dotTimer = setTimeout(() => {
            dotTimer = null;
            moveDot();
        }, 60);
    }
}

// Put the white dot on the line, at the place where the movie is now
function moveDot() {
    if (dotIndex < 0 || !lastMovieState || !currentAxes || !Object.keys(data).length) {
        return;
    }
    const s = lastMovieState;
    // interpolate the way the axis does (log or linear), so that the dot stays on the drawn line
    const at = (field, type) => {
        const column = data[field];
        if (!column) {
            return NaN;
        }
        const a = Number(column[s.i0]);
        const b = Number(column[s.i1]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            return NaN;
        }
        if (type === "log" && a > 0 && b > 0) {
            return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * s.f);
        }
        return a + (b - a) * s.f;
    };
    const x = at(currentAxes.x, currentAxes.xtype);
    const y = at(currentAxes.y, currentAxes.ytype);
    const ok = Number.isFinite(x) && Number.isFinite(y);
    Plotly.restyle("plotly-graph", { x: [[ok ? x : null]], y: [[ok ? y : null]] }, [dotIndex]);
}

function applyPreset(name) {
    const preset = (VARIANT == "single" ? GRAPH_PRESETS : GRAPH_PRESETS_BINARY)[name];
    if (!preset) {
        return;
    }
    $id("x-axis").value = preset.x;
    $id("y-axis").value = preset.y;
    $id("graph-style").value = preset.style;
    if (Object.keys(data).length) {
        plot();
        populateTable();
    }
}

// Save the graph as a picture: always the light version, which suits reports and slides
async function downloadGraph() {
    if (!Object.keys(data).length) {
        return;
    }
    const g = buildGraph({ light: true, forExport: true, height: 650 });
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-10000px;top:0;width:1100px;height:650px;";
    document.body.appendChild(holder);
    try {
        await Plotly.newPlot(holder, g.traces, { ...g.layout, width: 1100, height: 650 });
        await Plotly.downloadImage(holder, {
            format: "png",
            width: 1100,
            height: 650,
            scale: 2,
            filename: document.documentElement.lang === "nl" ? "sterrenstrijd-grafiek" : "star-workshop-graph",
        });
    } catch (error) {
        console.warn("Could not download the graph:", error);
    } finally {
        Plotly.purge(holder);
        holder.remove();
    }
}

// Things that depend on the simulator: name of step 2, ready-made graphs, text under the graph
function initGraphUI() {
    $id("graph-heading").dataset.i8n = "header-graph-movie";
    if (VARIANT != "single") {
        // other quick picks for two stars
        const select = $id("graph-preset");
        select.replaceChildren(
            ...["mass1", "radius1", "sep", "period", "hr1", "custom"].map((name) => {
                const option = $create("option");
                option.value = name;
                option.dataset.i8n = `graph-preset-${name}`;
                return option;
            }),
        );
    }
    $id("graph-preset-box").classList.replace("invisible", "visible");
    $id("movie-caption").dataset.i8n =
        VARIANT == "single" ? "movie-caption" : "movie-caption-binary";
    $id("graph-caption").dataset.i8n =
        VARIANT == "single" ? "graph-caption-single" : "graph-caption-binary";
}
// ===== graph: end =====

// The data as text. `excel` gives the version for Excel with Dutch settings: semicolons between
// the columns, a decimal comma in the numbers and a mark at the start (done in downloadData)
function dataToCSV(excel = false) {
    const sep = excel ? ";" : ",";
    let keys = Object.keys(data);
    if (VARIANT != "single") {
        // the same order as the table: time, mass transfer type, period, separation, eccentricity, then the rest
        const first = ["time", "transfertype", "period", "sep", "ecc"].filter((k) => keys.includes(k));
        keys = [...first, ...keys.filter((k) => !first.includes(k))];
    }
    const quote = (text) => (/[";,\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    const cell = (value) => {
        if (excel && typeof value === "number") {
            return String(value).replace(".", ",");
        }
        return quote(String(value ?? ""));
    };
    const header = keys.map((key) => quote(_t(`${key}-field`))).join(sep);
    const length = data[keys[0]].length;

    const rows = [];
    for (let i = 0; i < length; i++) {
        rows.push(keys.map((key) => cell(data[key][i])).join(sep));
    }

    return header + "\n" + rows.join("\n");
}

function downloadData(excel = false) {
    const csv = (excel ? "\ufeff" : "") + dataToCSV(excel);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = excel ? "SeBadata-excel.csv" : "SeBadata.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function addEventListeners() {
    $id("start-button").addEventListener("click", runSeba);
    $id("download-data").addEventListener("click", () => downloadData(false));
    $id("download-data-excel").addEventListener("click", () => downloadData(true));
    $id("download-graph").addEventListener("click", downloadGraph);
    $id("graph-preset").addEventListener("change", (event) => applyPreset(event.target.value));
    document.querySelectorAll(".lang button").forEach((button) => {
        button.addEventListener("click", () => switchLang(button.dataset.lang));
    });
    for (const id of ["graph-style", "x-axis", "y-axis"]) {
        const elem = $id(id);
        const newElem = elem.cloneNode(true);
        newElem.value = elem.value;
        newElem.addEventListener("change", () => {
            $id("graph-preset").value = "custom";
            plot();
            populateTable();
        });
        const parent = elem.parentNode;
        parent.replaceChild(newElem, elem);
    }

}

async function init() {
    if (DEBUG) {
        $id("program-log").classList.replace("invisible", "visible");
    }
    if (VARIANT == "single" || VARIANT == "double" || VARIANT == "binary") {
        $id("introduction").classList.replace("visible", "invisible");
        $id("controls").classList.replace("invisible", "visible");
        $id("graph").classList.replace("invisible", "visible");
        $id("data-section").classList.replace("invisible", "visible");
		
		if (VARIANT == "single"){
	        $id("introduction-star").classList.replace("invisible", "visible"); 
		}
		if (VARIANT == "double" || VARIANT == "binary"){
	        $id("introduction-binary").classList.replace("invisible", "visible"); 
		}
		
    } else {
        $id("introduction").classList.replace("invisible", "visible");
        $id("introduction-star").classList.replace("visible", "invisible");			
        $id("introduction-binary").classList.replace("visible", "invisible");			
        $id("controls").classList.replace("visible", "invisible");
        $id("graph").classList.replace("visible", "invisible");
        $id("data-section").classList.replace("visible", "invisible");
    }
    initGraphUI();
    createControls();
    updateMinMax();
    if (VARIANT != "single") {
        createCompanionSwitch();
        createOrbitSwitch();
    }
    /* Get a default language setting from the local storage */
    const lang = localStorage.getItem("lang") || DEFAULT_LANG;
    setLabels(lang); // show the right language in the menu and footer straight away

    addEventListeners();

    await loadTranslations();
    switchLang(lang);
    $id("start-button").disabled = false;
    initMovie();
}

// `init()` sets up some essentials after the page has loaded,
// such as event listeners
init();
