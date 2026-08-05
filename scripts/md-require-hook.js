const fs = require('fs');

// Mirrors esbuild's `.md: text` loader (a synthetic ES module with a
// `default` export) so `import x from './file.md'` resolves the same way
// under ts-node (tests) as it does in the esbuild-bundled Lambda output.
require.extensions['.md'] = function (module, filename) {
  module.exports = { default: fs.readFileSync(filename, 'utf8') };
};
