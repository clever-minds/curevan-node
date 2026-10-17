// Files that must never be served statically (clinical PDFs). Only controllers with an access check read them.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(process.env.PRIVATE_STORAGE_DIR || path.join(__dirname, "../../storage/private"));

/** Absolute path for a relative one, refusing anything that escapes the private folder. */
function resolve(relPath) {
  const full = path.resolve(ROOT, relPath);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) throw new Error("Invalid storage path");
  return full;
}

/** Make sure the folder for this relative file path exists; returns the absolute path. */
function prepare(relPath) {
  const full = resolve(relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  return full;
}

module.exports = { ROOT, resolve, prepare };
