// Isolated Docker tests use the repository's existing pure-JS TypeScript compiler.
// No package install, native esbuild binary, application bootstrap or network access.
const fs = require('node:fs');
const ts = require(process.env.MMS_TEST_TYPESCRIPT_PATH || 'typescript');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }, fileName: filename });
    module._compile(compiled.outputText, filename);
};
