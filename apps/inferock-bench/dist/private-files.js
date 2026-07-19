import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
export async function ensurePrivateDir(path) {
    await mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE });
    await chmod(path, PRIVATE_DIR_MODE);
}
export async function writePrivateTextFile(path, content, options = {}) {
    const parent = dirname(path);
    if (options.privateParent === false) {
        await mkdir(parent, { recursive: true, mode: PRIVATE_DIR_MODE });
    }
    else {
        await ensurePrivateDir(parent);
    }
    await writeFile(path, content, {
        encoding: "utf8",
        flag: options.flag ?? "w",
        mode: PRIVATE_FILE_MODE,
    });
    await chmod(path, PRIVATE_FILE_MODE);
}
//# sourceMappingURL=private-files.js.map