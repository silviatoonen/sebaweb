SeBaWeb is a webpage to run [SeBa](https://github.com/amusecode/SeBa/) in a web browser.
It uses a WebAssembly version of SeBa for this.

## Installation

There is no need to build anything: the files in this project can all be copied into a directory that can be found and served by a webserver.

The webserver should recognize and be able to serve WebAssembly (`.wasm`) files, which is fine for modern webservers.

### Files

The really necessary files for SeBaWeb to function as a webpage are

- index.html
- base.css
- base.js
- seba.js
- seba.wasm
- banner.jpg
- favicon.ico
- en.json
- nl.json

The `seba.js` and `seba.wasm` form the WebAssembly code. `base.js` takes care of interfacing between the webpage and the WebAssembly, including handling all the sliders, inputs and other interactive elements on the page.

The `*.json` files are translation files.


## Development

See the file [`development.md`](development.md) for details if you want to furhter develop SeBaWeb.


## Copyright & license

SeBaWeb is copyright (c) 2026, Universify of Amsterdam. It is licensed under the MIT license; see the LICENSE file.
