// Replace a module in require's cache so code under test gets a fake instead
// of the real thing (real persistence would open a Postgres pool, real auth
// would load OAuth config). Call BEFORE requiring the module under test.
// Works on every Node version, unlike mock.module().
function inject(relativeToTestDir, exports) {
  const resolved = require.resolve(relativeToTestDir, { paths: [__dirname + "/.."] });
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

module.exports = { inject };
