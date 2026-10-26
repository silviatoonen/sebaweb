// pop-worker.js – runs a SeBa population in the background for population.html.
//
// The population is run in batches: every batch is a fresh SeBa instance that simulates `batch`
// systems (-n batch -N first -s seed+k). The output of each batch is taken out of SeBa's in-memory
// file system straight away and (optionally) gzipped, so the browser never has to hold the whole
// file at once, and the page can show progress and stop a run in between batches.
// Batch k uses random seed (seed + k): the same seed and batch size give exactly the same file.
//
// Two watermarks show that a file was made on this page (the numbers themselves are not changed):
//  - every line ends with a tab; programs that split on whitespace (rdc_SeBa, numpy, pandas, awk)
//    ignore it, and native SeBa output has none (check with: grep -c $'\t$' file.data)
//  - the gzip file carries a comment in its header (see it with e.g. python's gzip module or 7-Zip)

import createSeBa from "./seba_default.js?v=1";

let stop = false;

function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

// watermark 1: a tab before every line end (and a line end after the last line, if it has none)
function tabAtLineEnds(bytes) {
    let lines = 0;
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 10) lines++;
    }
    const open = bytes.length > 0 && bytes[bytes.length - 1] !== 10;
    const out = new Uint8Array(bytes.length + lines + (open ? 2 : 0));
    let j = 0;
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 10) out[j++] = 9;
        out[j++] = bytes[i];
    }
    if (open) {
        out[j++] = 9;
        out[j++] = 10;
    }
    return out;
}

// watermark 2: a comment in the gzip header (flag FCOMMENT, RFC 1952). The header the browser writes
// is 10 bytes without extra fields; the comment (Latin-1, ending in a zero byte) goes right after it.
function withGzipComment(bytes, text) {
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || (bytes[3] & 0x1e) !== 0) {
        return bytes; // not the plain header we expect: leave it alone
    }
    const ascii = Array.from(text, (c) => (c.charCodeAt(0) < 256 && c !== "\0" ? c.charCodeAt(0) : 63));
    const out = new Uint8Array(bytes.length + ascii.length + 1);
    out.set(bytes.subarray(0, 10), 0);
    out[3] |= 0x10;
    out.set(ascii, 10);
    out[10 + ascii.length] = 0;
    out.set(bytes.subarray(10), 11 + ascii.length);
    return out;
}

self.onmessage = async (e) => {
    const msg = e.data;
    if (msg.type === "stop") {
        stop = true;
        return;
    }
    if (msg.type !== "run") {
        return;
    }
    stop = false;
    const { args, n, first, seed, batch, gzip, comment } = msg;
    const parts = []; // pieces of the output file (compressed or not)
    let bytesRaw = 0;
    let bytesOut = 0;

    // gzip: one stream for the whole file; a reader collects the compressed pieces as they come
    let writer = null;
    let reading = null;
    if (gzip) {
        const cs = new CompressionStream("gzip");
        writer = cs.writable.getWriter();
        const reader = cs.readable.getReader();
        reading = (async () => {
            let head = new Uint8Array(0); // the first bytes, until the 10-byte gzip header is complete
            let patched = false;
            for (;;) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }
                let chunk = value;
                if (!patched) {
                    head = concat(head, chunk);
                    if (head.length < 10) {
                        continue;
                    }
                    chunk = withGzipComment(head, comment || "");
                    patched = true;
                }
                parts.push(chunk);
                bytesOut += chunk.length;
            }
        })();
    }

    const t0 = performance.now();
    let doneSystems = 0;
    let k = 0;
    const commands = [];
    let failed = "";
    try {
        while (doneSystems < n && !stop) {
            const m = Math.min(batch, n - doneSystems);
            const start = first + doneSystems;
            const s = seed + k;
            const batchArgs = ["-R", "-n", String(m), "-N", String(start), "-s", String(s), ...args];
            commands.push("SeBa " + batchArgs.join(" "));
            const errors = [];
            const Mod = await createSeBa({
                print: () => {},
                printErr: (t) => {
                    if (/error|abort|exception/i.test(t) && errors.length < 5) {
                        errors.push(t);
                    }
                },
            });
            try {
                Mod.callMain(batchArgs);
            } catch (err) {
                failed = `SeBa stopped with an error in the batch with IDs ${start}–${start + m - 1} (seed ${s}): ${err}`;
                break;
            }
            let data;
            try {
                data = Mod.FS.readFile("SeBa.data");
            } catch (err) {
                throw new Error("SeBa did not write any output. " + errors.join(" "));
            }
            data = tabAtLineEnds(data);
            bytesRaw += data.length;
            if (gzip) {
                await writer.write(data);
            } else {
                parts.push(data);
                bytesOut += data.length;
            }
            doneSystems += m;
            k++;
            self.postMessage({
                type: "progress",
                done: doneSystems,
                n,
                bytesRaw,
                bytesOut,
                seconds: (performance.now() - t0) / 1000,
            });
            // let the compressor and the page catch up between batches
            await new Promise((r) => setTimeout(r, 0));
        }
        if (gzip) {
            await writer.close();
            await reading;
        }
        const blob = new Blob(parts, { type: gzip ? "application/gzip" : "text/plain" });
        self.postMessage({
            type: "done",
            blob,
            done: doneSystems,
            stopped: stop || !!failed,
            failed,
            bytesRaw,
            bytesOut: blob.size,
            seconds: (performance.now() - t0) / 1000,
            commands,
        });
    } catch (err) {
        self.postMessage({ type: "error", message: String(err && err.message ? err.message : err) });
    }
};
