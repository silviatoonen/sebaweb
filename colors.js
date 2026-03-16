// Define the temperature-color points
const TEMP_COLOR_STOPS = [
    { temp: 3500, color: [0x8b, 0x00, 0x00] }, // dark red
    { temp: 6000, color: [0xff, 0xd7, 0x00] }, // yellow
    { temp: 20000, color: [0xe0, 0xf0, 0xff] }, // white-blue
    { temp: 40000, color: [0x40, 0x70, 0xff] }, // blue
];

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

// Linear interpolation
function lerp(a, b, t) {
    return a + (b - a) * t;
}

// Interpolate between two RGB colors
// Simple interpolation per separate R, G and B channel
function lerpColor(c1, c2, t) {
    return [
        Math.round(lerp(c1[0], c2[0], t)),
        Math.round(lerp(c1[1], c2[1], t)),
        Math.round(lerp(c1[2], c2[2], t)),
    ];
}

function starColor(temp) {
    const imax = TEMP_COLOR_STOPS.length - 1;
    const minT = TEMP_COLOR_STOPS[0].temp;
    const maxT = TEMP_COLOR_STOPS[imax].temp;
    const T = clamp(temp, minT, maxT);

    for (let i = 0; i < imax; i++) {
        const t0 = TEMP_COLOR_STOPS[i].temp;
        const t1 = TEMP_COLOR_STOPS[i + 1].temp;
        if (T >= t0 && T <= t1) {
            const ratio = (T - t0) / (t1 - t0); // 0..1
            const c = lerpColor(
                TEMP_COLOR_STOPS[i].color,
                TEMP_COLOR_STOPS[i + 1].color,
                ratio,
            );
            return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
        }
    }

    // Fallback (shouldn’t reach here because of clamping)
    const c = TEMP_COLOR_STOPS[imax].color;
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export { starColor };
