import { createApp } from "./cli";
import { ensureInit } from "./init";
import { loadAll } from "./loader";
import { getPaths } from "./paths";
import { updateNotice } from "./upgrade";
import { VERSION } from "./version";

const argv = process.argv.slice(2);
const paths = getPaths();
ensureInit(paths);
const loaded = await loadAll(paths);
const code = await createApp(loaded, paths).run(argv);

// The notice awaits the network (1s cap, once a day), so skip it for scripts
// and for `upgrade` itself, where it would be noise.
if (process.stderr.isTTY && argv[0] !== "upgrade") {
  try {
    const notice = await updateNotice({
      version: VERSION,
      repo: loaded.config.upgrade?.repo ?? "whirlwin/cli-eastwood",
      statePath: paths.state,
      enabled: loaded.config.upgrade?.checkOnStartup !== false && !process.env.CI,
    });
    if (notice) console.error(notice);
  } catch {
    // an update check must never affect the command
  }
}
process.exit(code);
