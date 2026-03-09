// DATAFIELDS are the keys of the columns in SeBa.data
// This needs to include all columns
export const DATAFIELDS = [
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

// The data columns only of interest to the user
// These need to match the names in DATAFIELDS
export const USERDATAFIELDS = [
    "time",
    "type1",
    "mass1",
    "radius1",
    "efftemp1",
    "coremass1",
    "lum1",
    "type2",
    "mass2",
    "radius2",
    "efftemp2",
    "coremass2",
    "lum2",
    "transfertype",
    "sep",
    "ecc",
];

export const CONTROLS = {
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

// The order of the controls on the page
// (Since CONTROLS is an object, the order of keys is not guaranteed)
export const CONTROL_ORDER = ["mass1", "mass2", "ecc", "sep", "time", "metal"];
