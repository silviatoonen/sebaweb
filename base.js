import createSeBa from "./seba.js";

/* Physics constants */
const SIGMA_SB = 5.670374419e-8;
const R_SUN = 695.7e6;
const L_SUN = 3.828e26;

const FALLBACK_LANG = "en";
// Give the user some milliseconds to update a value before
// running SeBa again
const INPUTTIMEOUT = 500;
// all data fields output by SeBa in `seba.data`
const DATAFIELDS = [
    "binid",
    "bintype",
    "transfertype",
    "time",
    "sep",
    "ecc",
    "id1",
    "type1",
    "mass1",
    "radius1",
    "efftemp1",
    "coremass1",
    "id2",
    "type2",
    "mass2",
    "radius2",
    "efftemp2",
    "coremass2",
];

// data columns only of interest
const USERDATAFIELDS = [
    "transfertype",
    "time",
    "sep",
    "ecc",
    "id1",
    "type1",
    "mass1",
    "radius1",
    "efftemp1",
    "coremass1",
    "lum1",
    "id2",
    "type2",
    "mass2",
    "radius2",
    "efftemp2",
    "coremass2",
    "lum2",
];

const CONTROLS = {
    mass1: {
        min: 0.01,
        max: 100,
        value: 2,
        step: 0.01,
        prec: 2,
        log: true,
    },
    mass2: {
        min: 0.01,
        max: 100,
        value: 1,
        step: 0.01,
        prec: 2,
        log: true,
    },
    ecc: {
        min: 0,
        max: 1,
        value: 0.2,
        step: 0.0001,
        prec: 4,
        log: false,
    },
    sep: {
        min: 1,
        max: 1e4,
        value: 200,
        step: 0.01,
        prec: 1,
        log: true,
    },
    time: {
        min: 1,
        max: 1e7,
        value: 13500,
        step: 0.1,
        prec: 0,
        log: true,
    },
    metal: {
        min: 1e-4,
        max: 0.03,
        value: 2e-2,
        step: 0.0001,
        prec: 5,
        log: true,
    },
};
const CONTROL_ORDER = ["mass1", "mass2", "ecc", "sep", "time", "metal"];

const GRAPHDEFAULTS = {
    x: "time",
    y: "sep",
};

// Supported languages with a translation file
const LANGUAGES = ["en", "nl"];

const stdoutElem = $q("#program-log output");

// Collect output lines in memory as well
const stdoutLines = [];
const stderrLines = [];

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
    for (const col of USERDATAFIELDS) {
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
    for (const name of CONTROL_ORDER) {
        const control = CONTROLS[name];
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
        });
        slider.addEventListener("input", function (evt) {
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
        });
        input.addEventListener("input", function (evt) {
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
        const control = CONTROLS[name];
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
        for (const field of USERDATAFIELDS) {
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
    if ((!lang) in translations) {
        lang = FALLBACK_LANG;
    }
    const translation = translations[lang];
    const elements = document.querySelectorAll("[data-i8n]");
    for (const element of elements) {
        const key = element.dataset.i8n;
        if (key in translation) {
            element.innerHTML = translation[key];
        } else {
            console.log(
                `falling back to default translation for ${key} = ${value}`,
            );
            element.innerHTML = translations[FALLBACK_LANG][key];
        }
    }
    updateTableHeader();
    updatePlotOptions();
}

function updateFromSlider(slider) {
    const id = `${slider.dataset.input}`;
    let input = $id(`${id}-input`);
    const control = CONTROLS[id];
    const actualValue = control["log"]
        ? Math.pow(10, parseFloat(slider.value))
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

    const control = CONTROLS[id];
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
    if ((!lang) in translations) {
        lang = FALLBACK_LANG;
    }
    const translation = translations[lang];
    let string = "";
    if ((!key) in translation) {
        string = translations[FALLBACK_LANG][key];
    } else {
        string = translation[key];
    }
    if (!string) {
        string = "";
    }
    return string;
}

function createConfig() {
    return;
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

    const args = [
        "-M",
        document.getElementById("mass1-input").value.trim(),
        "-m",
        document.getElementById("mass2-input").value.trim(),
        "-e",
        document.getElementById("ecc-input").value.trim(),
        "-a",
        document.getElementById("sep-input").value.trim(),
        "-T",
        document.getElementById("time-input").value.trim(),
        "-z",
        document.getElementById("metal-input").value.trim(),
    ];

    // Remove previous SeBa.data if it exists
    try {
        Module.FS.unlink("SeBa.data");
    } catch (e) {
        // Ignore if file did not exist
        console.log(
            "Ignoring error when attempting to remove 'SeBa.data': ",
            e,
        );
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
        // Clear event listeners and readd then,
        // so that the graph updates with the current data
        // Since the listeners are an anonymous closure over `data`,
        // we replace the element with a clone; the clone doesn't
        // copy the listener, so a new listener is added, which is
        // then the only listener
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
    var array = Array.from({ length: 18 }, (_) => []);
    const lines = fileContent.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        const cols = trimmed.split(/\s+/);
        for (const i in cols) {
            array[i].push(parseFloat(cols[i]));
        }
    }

    data = {};
    DATAFIELDS.forEach((name, index) => {
        data[name] = array[index];
    });
    /* Add luminosity as a derived column */
    data["efftemp1"] = data["efftemp1"].map((value) => Math.pow(10, value));
    data["efftemp2"] = data["efftemp2"].map((value) => Math.pow(10, value));
    data["lum1"] = data["radius1"].map(
        (item, i) =>
            (4 *
                Math.PI *
                SIGMA_SB *
                Math.pow(item * R_SUN, 2) *
                Math.pow(data["efftemp1"][i], 4)) /
            L_SUN,
    );
    data["lum2"] = data["radius2"].map(
        (item, i) =>
            (4 *
                Math.PI *
                SIGMA_SB *
                Math.pow(item * R_SUN, 2) *
                Math.pow(data["efftemp2"][i], 4)) /
            L_SUN,
    );

    return data;
}

function populateTable(data) {
    let trs = [];
    for (var rownr = 0; rownr < data[USERDATAFIELDS[0]].length; ++rownr) {
        let tr = $create("tr");
        for (const col of USERDATAFIELDS) {
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
    if ((!xaxis) in data) {
        xaxis = GRAPHDEFAULTS["x"];
    }
    if ((!yaxis) in data) {
        yaxis = GRAPHDEFAULTS["y"];
    }

    const graphtype = $id("graph-style").value;
    let xtype = "log";
    let ytype = "log";
    if (graphtype == "linlin") {
        xtype = "linear";
        ytype = "linear";
    }
    if (graphtype == "loglin") {
        xtype = "log";
        ytype = "linear";
    }
    if (graphtype == "linlog") {
        xtype = "linear";
        ytype = "log";
    }

    let plottingData = {
        x: data[xaxis],
        y: data[yaxis],
        type: "scatter",
    };

    let width = $id("graph").offsetWidth ?? 700;
    width -= 100;

    let layout = {
        xaxis: {
            type: xtype,
            autorange: true,
        },
        yaxis: {
            type: ytype,
            autorange: true,
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

function init() {
    createControls();
    updateMinMax();
    $id("start-button").addEventListener("click", runSeba);
    $id("download-data").addEventListener("click", downloadData);
    $id("lang-switch").addEventListener("change", (event) =>
        switchLang(event.target.value),
    );
    loadTranslations().then(() => {
        switchLang("nl");
        $id("start-button").disabled = false;
    });
}

// `init()` sets up some essentials after the page has loaded,
// such as event listeners
init();
