# Development

SeBaWeb is separated into the classic trinity of HTML, CSS and JavaScript. The relevant files are `index.html`, `base.css` and `base.js`. These are the files you would be editing. The other files are images (`banner.jpg` and `favicon.ico`), WebAssembly files (`seba_default.wasm` and `seba_hirestime.wasm`) and related JavaScript files that handle the interface with the WebAssembly files.

For more details on the WebAssembly part, see below.


If you want to extend the functionality of SeBaWeb, or simply want to update some texts or styling, here are some suggestions:

- Stick to `index.html`, `base.css` and `base.js` (and possibly images). `seba_*.js` should not be altered, otherwise you may lose functionality running the actual SeBa WebAssembly binary.

- If you just want to change some input parameter settings, like a minimum, maximum or default value, edit the `constants-*.js` file(s).

- Do not hard code any text in the `index.html` or `base.js` files. You can have dummy text, but use a key-phrase with a `data-i8n` attribute in the HTML file (see examples of its use in `index.html`). When setting text in `base.js`, use the `_t` (translate) function with an appropriate key-phrase (also usage examples in `base.js`).

- All translations from key-phrases to supported languages are provided in the various `*.json` files. These are straightforward as far as content and format concerns; update these files if you have new text(s) to add.

- format the HTML, CSS, `base.js` and JSON files afterwards. See `format.sh` for details of the chosen indentation and formatter; you can simply run `sh format.sh` to ensure all files are formatted.


## The WebAssembly files

WebAssembly (wasm) is a binary format that allows executable to run (in a virtual machine-like environment) in the browser. The SeBa code is compiled using a specific compiler, with the resulting binary being a WebAssembly file. For more general information, see the [Wikipedia page on WebAssembly](https://en.wikipedia.org/wiki/WebAssembly) or the [Mozilla Developer Pages](https://developer.mozilla.org/en-US/docs/WebAssembly).

Note: you do *not* need to build the WebAssembly files yourself: the `seba_*.wasm` files are already fully functional binary WebAssembly files. It is not common to include binary executables into a (source code) repository, but here it is done for practical reasons.

### Two variants

There are two variants of the wasm files: the default (standard SeBa) one, and one that is derived from a patched SeBa version that has higher time-resolution output (hence the `_hirestime` part in the name).

The patch itself is a Git diff file, [`hires-time.patch`](./hires-time.patch). You can see in that file that the changes are relatively simple: an extra output call, and a higher number of steps.

The two variants are always loaded (see the first lines of [`seba.js`](./seba.js)). Internally, the JavaScript checks the URL query parameters to see if there is a `variant=single` parameter. If so, it will use the high-resolution time variant, otherwise it will use the default version.

### Single & binary

The two variants of time resolution relate directly to the (user-visible) variants of SeBaWeb: one for binary evolution (the default), and one for single star evolution. In the latter case (which is deduced from the query parameter, as mentioned above), not only is a different wasm file used, but several input parameters are hidden and set to a default value (eccentricity to 0 and separation to a large value, so there is a wide circular orbit with no interaction), and some are renamed (there is no "star 1" and "star 2", just "star"). In the code, look for the `USE_SINGLE` constant to see where these changes are.

Finally, there are two short JavaScript files that contain a bunch of constants relevant for each of the variants, aptly named [`constants-binary.js`](./constants-binary.js) and [`constants-single.js`](./constants-single.js). Any changes to default input parameters you want to make should probably be done here.

### Compiling the WebAssembly files

If there has been a change in the SeBa code itself that is also essential for the web version, you may want to recompile `seba_default.wasm` and `seba_hirestime.wasm`.

For building `seba_*.wasm`, make sure you have Emscripten installed: it is probably available through a package manager (Homebrew on macOS, for example).
Emscripten entails a suite of compilers: a C and C++ compiler, a linker and some other tools. The executable you'll need are `emcc`, `em++`, `emar` and `emranlib`, but you probably want the full suite properly installed, since these executables may have dependencies on other Emscripten tools.

Once installed, you can use the [`build.sh`](./build.sh) script in this directory: it requires the root directory of the SeBa source code as its first argument, and will then

1. restore the SeBa Git repository to its original state (if necessary)
2. "clean" (i.e., `make clean`) the SeBa source code
3. build all code using Emscripten compilers for the default variant
4. copy the resulting files `seba_default.wam` and `seba_default.js` into the directory where the `build.sh` is located (that is, this directory).
5. apply the Git patch to the repository: `git apply hires-time.patch`
6. clean and rebuild all the code for the hires-time variant
7. copy the resulting files `seba_hirestime.wam` and `seba_hirestime.js` into the directory where the `build.sh` is located.
8. restore the SeBa Git repository to its original state

Note that the patch may not apply cleanly, depending on what has changed in the SeBa code. If that happens, apply the two changes manually and update the patch (`git diff > hires-time.patch`).
