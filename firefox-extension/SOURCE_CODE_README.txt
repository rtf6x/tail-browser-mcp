Tail MCP — source code for AMO review
Version: 2.0.0

Requirements
- Node.js 18 or newer
- npm

Directory layout (archive root = add-on source)
- manifest.json, *.ts, options.html, assets/  — add-on source
- dist/                                         — esbuild output referenced by manifest (rebuilt in step 4)
- common/                                         — shared dependency (@tail-browser-mcp/common)

Build instructions
1. Unzip this archive to a directory (manifest.json must be at that directory root).
2. cd common && npm install && cd ..
3. npm install
4. npm run build

Expected output
- dist/background.js  (esbuild bundle)
- dist/options.js     (esbuild bundle)

Verify XPI (optional)
- npm run pack-xpi
- Creates tail-mcp-dev.xpi in the parent directory when run from a full git checkout;
  from this archive alone, zip manifest.json dist options.html assets manually after build.

Build tool
- esbuild 0.25.1
- Commands: esbuild background.ts --bundle --outfile=dist/background.js
           esbuild options.ts --bundle --outfile=dist/options.js

Notes
- Extension registers browserId on WebSocket connect; localhost trust by default
- HTML/CSS (options.html) are not processed by a build tool
- esbuild bundles common/ via the local file dependency in package.json
- Tests (optional): npm test
