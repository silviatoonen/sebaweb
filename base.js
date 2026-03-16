import createSeBaDefault from "./seba_default.js";
import createSeBaHires from "./seba_hirestime.js";
import * as C_S from "./constants-single.js";
import * as C_B from "./constants-binary.js";
import { starColor } from "./colors.js";

const params = new URLSearchParams(window.location.search);
const VARIANT = params.get("variant");
const DEBUG = params.get("debug") == "debug";

const CONST = VARIANT == "single" ? C_S : C_B;
const createSeBa = VARIANT == "single" ? createSeBaHires : createSeBaDefault;

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
    y: VARIANT == "single" ? "mass" : "mass1",
};

const GRAPH_SCALES = {
    linlin: ["linear", "linear"],
    linlog: ["linear", "log"],
    loglin: ["log", "linear"],
    loglog: ["log", "log"],
};

const PLOTLY_DARK_MODE = {
    paper_bgcolor: "#1a1a1a",
    plot_bgcolor: "#222",
    font: { color: "#f0f0f0" },
    xaxis: { color: "#f0f0f0", gridcolor: "#444", zerolinecolor: "#555" },
    yaxis: { color: "#f0f0f0", gridcolor: "#444", zerolinecolor: "#555" },
};

// Starting sizes in pixels
const SIZES = {
    earth: 10 / 109,
    sun: 10,
    star: 0,
    star2: 0,
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
let rafid = null;

function updateTableHeader() {
    const lang = document.documentElement.lang;
    const translation = translations[lang];
    let ths = [];
    for (const col of CONST.USERDATAFIELDS) {
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
            const response = await fetch(`${lang}.json`);

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

function switchLang(lang) {
    document.documentElement.lang = lang;
    if (!(lang in translations)) {
        lang = FALLBACK_LANG;
    }
    localStorage.setItem("lang", lang);
    const translation = translations[lang];
    const elements = document.querySelectorAll("[data-i8n]");
    for (const element of elements) {
        const key = element.dataset.i8n;
        if (key in translation) {
            element.innerHTML = translation[key];
        } else {
            const value = translations[FALLBACK_LANG][key];
            console.log(
                `falling back to default translation for ${key} = ${value}`,
            );
            element.innerHTML = value;
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
}

// Update HTML data-theme attribute for use in the CSS
// and replot if there was a theme switch
function switchTheme(theme) {
    if (theme === "system") {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = theme;
    }
    localStorage.setItem("theme", theme);

    if (Object.keys(data).length) {
        plot();
    }
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
    if (!string) {
        string = "";
    }
    return string;
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
                  $id("mass2-input").value.trim(),
                  "-e",
                  $id("ecc-input").value.trim(),
                  "-a",
                  $id("sep-input").value.trim(),
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
        // Enable graph options
        $id("graph-style").disabled = false;
        $id("x-axis").disabled = false;
        $id("y-axis").disabled = false;
        $id("show-size").disabled = false;
        populateTable();
        plot();
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
}

function populateTable() {
    let trs = [];
    for (let rownr = 0; rownr < data[CONST.USERDATAFIELDS[0]].length; ++rownr) {
        let tr = $create("tr");
        for (const col of CONST.USERDATAFIELDS) {
            const td = $create("td");
            td.textContent = data[col][rownr];
            tr.appendChild(td);
        }
        trs.push(tr);
    }
    let tbody = $q("#data-table tbody");
    tbody.replaceChildren(...trs);
}

function plot() {
    let xaxis = $id("x-axis").value;
    let yaxis = $id("y-axis").value;
    if (!(xaxis in data)) {
        xaxis = GRAPHDEFAULTS["x"];
    }
    if (!(yaxis in data)) {
        yaxis = GRAPHDEFAULTS["y"];
    }

    const graphtype = $id("graph-style").value;
    const [xtype, ytype] = GRAPH_SCALES[graphtype] ?? ["log", "log"];

    let plottingData = {
        x: data[xaxis],
        y: data[yaxis],
        type: "scatter",
    };

    let width = $id("graph").offsetWidth ?? 700;
    width -= 100;

    let theme = document.documentElement.dataset.theme; // explicit user-set theme
    if (theme) {
        theme = theme === "dark" ? PLOTLY_DARK_MODE : {};
    } else {
        // default to OS / browser theme
        theme = window.matchMedia("(prefers-color-scheme: dark)").matches
            ? PLOTLY_DARK_MODE
            : {};
    }
    const shapes = {
        type: "line",
        x0: 0,
        x1: 0,
        y0: 0,
        y1: 1,
        yref: "paper",
        line: { color: "red", width: 1, dash: "dot" },
        visible: false,
    };
    const layout = {
        ...theme,
        xaxis: {
            type: xtype,
            autorange: true,
            ...theme.xaxis,
        },
        yaxis: {
            type: ytype,
            autorange: true,
            ...theme.yaxis,
        },
        width: width,
        shapes: [shapes],
    };
    Plotly.newPlot("plotly-graph", [plottingData, shapes], layout);
}

function dataToCSV() {
    const keys = Object.keys(data);
    const header = keys.map((key) => _t(`${key}-field`)).join(",");
    const length = data[keys[0]].length;

    const rows = [];
    for (let i = 0; i < length; i++) {
        const row = keys.map((key) => data[key][i] ?? "").join(",");
        rows.push(row);
    }

    return header + "\n" + rows.join("\n");
}

function downloadData() {
    const csv = dataToCSV(data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "SeBadata.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function addEventListeners() {
    $id("start-button").addEventListener("click", runSeba);
    $id("download-data").addEventListener("click", downloadData);
    $id("lang-switch").addEventListener("change", (event) => {
        switchLang(event.target.value);
    });
    $id("theme-switch").addEventListener("change", (event) => {
        switchTheme(event.target.value);
    });
    for (const id of ["graph-style", "x-axis", "y-axis"]) {
        const elem = $id(id);
        const newElem = elem.cloneNode(true);
        newElem.value = elem.value;
        newElem.addEventListener("change", () => {
            plot();
            populateTable();
        });
        const parent = elem.parentNode;
        parent.replaceChild(newElem, elem);
    }

    $id("show-size").addEventListener("change", (event) => {
        if (event.target.checked) {
            $id("star-size-zoomrange").style.display = "block";
            $id("star-size-zoomvalue").style.display = "block";
            $id("sun-earth-scale").style.display = "block";
            $id("star-size-graph").style.display = "block";
            const zoom = $id("star-size-zoomrange").value;
            const scale = 10 ** parseFloat(zoom);
            //$id("star-size-zoomvalue").innerHTML =
            //    _t("scale-zoom") + `: ${scale.toPrecision(3)}`;
        } else {
            $id("star-size-zoomrange").style.display = "none";
            $id("star-size-zoomvalue").style.display = "none";
            $id("sun-earth-scale").style.display = "none";
            $id("star-size-graph").style.display = "none";
        }
    });
    $id("star-size-zoomrange").addEventListener("change", (event) => {
        const scale = 10 ** parseFloat(event.target.value);
        // $id("star-size-zoomvalue").innerHTML =
        //     _t("scale-zoom") + `: ${scale.toPrecision(3)}`;
        const earth = $id("earth");
        earth.setAttribute("r", SIZES["earth"] * scale);
        $id("sun").setAttribute("r", SIZES["sun"] * scale);
        $id("star").setAttribute("r", SIZES["star"] * scale);
        $id("star2").setAttribute("r", SIZES["star2"] * scale);
    });

    const graph = $id("plotly-graph");
    graph.addEventListener("mousemove", function (event) {
        if (!$id("show-size").checked) {
            return;
        }
        if (rafid) {
            cancelAnimationFrame(rafid);
        }
        rafid = requestAnimationFrame(() => {
            const fullLayout = graph._fullLayout;
            const margin = fullLayout.margin;
            const bb = graph.getBoundingClientRect();
            const xPixel = event.clientX - bb.left - margin.l;
            if (xPixel > 0 && xPixel < fullLayout.width - margin.l - margin.r) {
                const time = fullLayout.xaxis.p2d(xPixel);
                // Use Plotly.relayout for high-performance updates
                Plotly.relayout(graph, {
                    "shapes[0].x0": time,
                    "shapes[0].x1": time,
                    "shapes[0].visible": true,
                });
                if (VARIANT == "single") {
                    const radius = interpolateRadius(time, "radius");
                    SIZES["star"] = SIZES["sun"] * radius;
                    const scale =
                        10 ** parseFloat($id("star-size-zoomrange").value);
                    $id("star").setAttribute("r", SIZES["star"] * scale);

                    const temp = interpolateRadius(time, "efftemp");
                    $id("star").setAttribute("fill", starColor(temp));
                } else {
                    const radius = interpolateRadius(time, "radius1");
                    SIZES["star"] = SIZES["sun"] * radius;
                    const scale =
                        10 ** parseFloat($id("star-size-zoomrange").value);
                    $id("star").setAttribute("r", SIZES["star"] * scale);

                    const temp = interpolateRadius(time, "efftemp1");
                    $id("star").setAttribute("fill", starColor(temp));

                    const radius2 = interpolateRadius(time, "radius2");
                    SIZES["star2"] = SIZES["sun"] * radius2;
                    const scale2 =
                        10 ** parseFloat($id("star-size-zoomrange").value);
                    $id("star2").setAttribute("r", SIZES["star2"] * scale2);

                    const temp2 = interpolateRadius(time, "efftemp2");
                    $id("star2").setAttribute("fill", starColor(temp2));
                }
            }
        });
    });
    graph.addEventListener("mouseleave", function () {
        Plotly.relayout(graph, { "shapes[0].visible": false });
    });
}

function interpolateRadius(time, rkey) {
    const times = data["time"];
    const n = times.length;
    const radii = data[rkey];
    let i = -1;
    let w1 = 1.0;
    let w2 = 0.0;
    if (time < times[0]) {
        i = 0;
    } else if (time >= times[n - 1]) {
        i = n - 1;
    } else {
        for (const [j, t] of times.entries()) {
            if (t >= time) {
                const dt = t - times[j - 1];
                w1 = dt / (time - times[j - 1]); // before
                w2 = dt / (t - time); // after
                i = j;
                break;
            }
        }
    }

    // weight average
    return (radii[i - 1] * w1 + radii[i] * w2) / (w1 + w2);
}

async function init() {
    if (DEBUG) {
        $id("program-log").style.display = "block";
    }
    if (VARIANT == "single" || VARIANT == "double" || VARIANT == "binary") {
        $id("introduction").style.display = "none";
        $id("controls").style.display = "block";
        $id("graph").style.display = "block";
        $id("data-section").style.display = "block";
    } else {
        $id("introduction").style.display = "block";
        $id("controls").style.display = "none";
        $id("graph").style.display = "none";
        $id("data-section").style.display = "none";
    }
    createControls();
    updateMinMax();
    /* Get a default language setting from the local storage */
    const lang = localStorage.getItem("lang") || DEFAULT_LANG;
    $id("lang-switch").value = lang;
    /* Get a default theme/mode setting from the local storage */
    const theme = localStorage.getItem("theme") || "system";
    $id("theme-switch").value = theme;
    if (theme !== "system") {
        document.documentElement.dataset.theme = theme;
    }

    addEventListeners();

    await loadTranslations();
    switchLang(lang);
    $id("start-button").disabled = false;
}

// `init()` sets up some essentials after the page has loaded,
// such as event listeners
init();
