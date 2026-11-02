#! /bin/sh

# Run this script from its current directory,
# with the directory of the SeBa source code as its argument
# For example,
#   sh build.sh $OHME/codes/SeBa
#
# The script will clean and build SeBa using Emscripten,
# then copy the necessary files (seba.js and seba.wasm)
# to the current directory, so it can be found by the
# webserver
#
# Total running time of the scripts is several minutes

script=$(readlink -f "$0")
scriptdir=$(dirname "$script")


sebadir="$1"
echo "Building SeBa in $sebadir"

# The SeBa Makefiles call 'ar' directly to pack the compiled files into libraries. On a Mac that
# is Apple's ar, which cannot pack WebAssembly files (the libraries come out empty, and the last
# step then fails with "undefined symbol: cnsts"). So during this build, 'ar' means Emscripten's emar.
shim=$(mktemp -d)
printf '#!/bin/sh\nexec emar "$@"\n' > "$shim/ar"
chmod +x "$shim/ar"
export PATH="$shim:$PATH"

cd $sebadir

# Restore the repository, in case there were applied patches
git restore .

make clean

# Note: this builds an ES6 (EcmaScript 6) *module*, not a plain JavaScript file. Import accordingly:
# import createMyProg from './myprog.js';
LDFLAGS="-s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE -s -s EXPORT_ES6 -s EXPORTED_FUNCTIONS=\"['_main']\" -s ENVIRONMENT='web,worker' -s EXPORTED_RUNTIME_METHODS='[\"FS\",\"callMain\"]' -s INVOKE_RUN=0" CC=emcc CXX=em++ AR=emar RANLIB=emranlib make
cd dstar
LDFLAGS="-s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE -s -s EXPORT_ES6 -s EXPORTED_FUNCTIONS=\"['_main']\" -s ENVIRONMENT='web,worker' -s EXPORTED_RUNTIME_METHODS='[\"FS\",\"callMain\"]' -s INVOKE_RUN=0" CC=emcc CXX=em++ AR=emar RANLIB=emranlib make
# Run the last compilation command again, with a different output file, seba.js
em++ -I../include -I../include/star -D_SRC_='"no_source_available"' -DHAVE_CONFIG_H  -DTOOLBOX  -O  -s ALLOW_MEMORY_GROWTH=1 -s WASM=1 -s EXPORTED_FUNCTIONS="['_main']" -s MODULARIZE -s EXPORT_ES6  -s ENVIRONMENT='web,worker'  -s EXPORTED_RUNTIME_METHODS='["FS","callMain"]' -s INVOKE_RUN=0 SeBa.C  -L. -ldstar -L../sstar -lsstar -L../node -lnode -L../node/dyn -ldyn -L../std -lstd -lm -o seba_default.js

cp seba_default.js $scriptdir/
cp seba_default.wasm $scriptdir/


# Patch the git repository for high-time resolution
cd $sebadir
git apply $scriptdir/hires-time.patch

# Clean and build again with the changes
make clean
LDFLAGS="-s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE -s -s EXPORT_ES6 -s EXPORTED_FUNCTIONS=\"['_main']\" -s ENVIRONMENT='web,worker' -s EXPORTED_RUNTIME_METHODS='[\"FS\",\"callMain\"]' -s INVOKE_RUN=0" CC=emcc CXX=em++ AR=emar RANLIB=emranlib make
cd dstar
LDFLAGS="-s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE -s -s EXPORT_ES6 -s EXPORTED_FUNCTIONS=\"['_main']\" -s ENVIRONMENT='web,worker' -s EXPORTED_RUNTIME_METHODS='[\"FS\",\"callMain\"]' -s INVOKE_RUN=0" CC=emcc CXX=em++ AR=emar RANLIB=emranlib make
# Run the last compilation command again, with a different output file, seba.js
em++ -I../include -I../include/star -D_SRC_='"no_source_available"' -DHAVE_CONFIG_H  -DTOOLBOX  -O  -s ALLOW_MEMORY_GROWTH=1 -s WASM=1 -s EXPORTED_FUNCTIONS="['_main']" -s MODULARIZE -s EXPORT_ES6  -s ENVIRONMENT='web,worker'  -s EXPORTED_RUNTIME_METHODS='["FS","callMain"]' -s INVOKE_RUN=0 SeBa.C  -L. -ldstar -L../sstar -lsstar -L../node -lnode -L../node/dyn -ldyn -L../std -lstd -lm -o seba_hirestime.js
# Copy to different file
cp seba_hirestime.js $scriptdir/
cp seba_hirestime.wasm $scriptdir/

# Restore the repository (from its top folder: we are still in dstar here)
cd $sebadir
git restore .


