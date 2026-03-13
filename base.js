import createSeBaDefault from "./seba_default.js";
import createSeBaHires from "./seba_hirestime.js";
import * as C_S from "./constants-single.js";
import * as C_B from "./constants-binary.js";

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
let data = {};

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
    updateTableHeader();
    updatePlotOptions();
}

// Update HTML data-theme attribute for use in the CSS
// and replot if there was a theme switch
function switchTheme(theme) {
    console.log(theme, typeof theme);
    if (theme === "system") {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = theme;
    }
    localStorage.setItem("theme", theme);

    if (Object.keys(data).length) {
        plot(data);
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
        const text = Module.FS.readFile("SeBa.data", { encoding: "utf8" });
        data = readData(text);

        $id("download-data").disabled = false;
        // Enable graph options
        $id("graph-style").disabled = false;
        $id("x-axis").disabled = false;
        $id("y-axis").disabled = false;

        populateTable(data);
        plot(data);
    } catch (e) {
        appendOutput("Could not read SeBa.data: " + e, true);
    }

    // Reset the start button and status field
    $id("start-button").disabled = false;
    $id("status").textContent = "";
}

function readData(fileContent) {
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
    /* Add luminosity as a derived column */
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

    return data;
}

function populateTable(data) {
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

function plot(data) {
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
    };
    Plotly.newPlot("plotly-graph", [plottingData], layout);
}

function dataToCSV(data) {
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
            plot(data);
            populateTable(data);
        });
        const parent = elem.parentNode;
        parent.replaceChild(newElem, elem);
    }
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
