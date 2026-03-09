// DATAFIELDS are the keys of the columns in SeBa.data
// This needs to include all columns
export const DATAFIELDS = [
    "binid",
    "bintype",
    "transfertype",
    "time",
    "sep",
    "ecc",
    "id",
    "type",
    "mass",
    "radius",
    "efftemp",
    "coremass",
    "id2",
    "type2",
    "mass2",
    "radius2",
    "efftemp2",
    "coremass2",
];

// The data columns only of interest to the user
// These need to match the names in DATAFIELDS
export const USERDATAFIELDS = [
    "time",
    "type",
    "mass",
    "radius",
    "efftemp",
    "coremass",
    "lum",
];

// The settings of the visible controls for input parameters
export const CONTROLS = {
    mass: {
        min: 0.01,
        max: 100,
        value: 2,
        step: 0.01,
        prec: 2,
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
export const DEFAULT_PARAMS = {
    mass2: 0.1,
    ecc: 0,
    sep: 10000,
};

// The order of the controls on the page
// (Since CONTROLS is an object, the order of keys is not guaranteed)
export const CONTROL_ORDER = ["mass", "time", "metal"];
