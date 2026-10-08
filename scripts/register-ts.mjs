// Lets Node run the project's TypeScript directly (scripts and tests), without
// a build step or extra packages. Node strips the types itself; this hook only
// resolves imports the way tsconfig.json does: "@/..." from the project root,
// and "./file" without the ".ts" extension.
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
    let base = null;
    if (specifier.startsWith("@/")) {
      base = new URL(specifier.slice(2), root);
    } else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:")
    ) {
      base = new URL(specifier, context.parentURL);
    }
    if (base) {
      for (const candidate of [base.href, `${base.href}.ts`, `${base.href}/index.ts`]) {
        if (isFile(new URL(candidate))) return nextResolve(candidate, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
