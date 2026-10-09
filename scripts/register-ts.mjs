// Lets Node run the project's TypeScript directly (scripts and tests), without
// a build step or extra packages. Node strips the types itself; this hook only
// resolves imports the way tsconfig.json does: "@/..." from the project root,
// "./file" without the ".ts" extension, and "server-only" as Next.js does.
//
//   node --import ./scripts/register-ts.mjs scripts/seed.ts
import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);

function isFile(url) {
  try {
    return statSync(fileURLToPath(url)).isFile();
  } catch {
    return false;
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Next.js provides "server-only" itself (it fails a client bundle). Outside
    // Next, in scripts and tests, it is an empty module.
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export {};", shortCircuit: true };
    }
    let base = null;
    if (specifier.startsWith("@/")) {
      base = new URL(specifier.slice(2), root);
    } else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:")
    ) {
      base = new URL(specifier, context.parentURL);
      // An existing file (e.g. a package's own "./cjs/x.js") is left exactly as
      // written: CommonJS require() does not accept file:// URLs.
      if (isFile(base)) return nextResolve(specifier, context);
    }
    if (base) {
      for (const candidate of [base.href, `${base.href}.ts`, `${base.href}/index.ts`]) {
        if (isFile(new URL(candidate))) return nextResolve(candidate, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
