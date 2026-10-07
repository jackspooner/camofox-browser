import { Camoufox, listInstalled } from "@camoufox/camoufox";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
export async function launchNativeBrowser(options, profileDir) {
  const pinned = (await listInstalled()).find(
    (v) =>
      v.repoName === "official" &&
      v.version.version === "156.0.1" &&
      v.version.build === "beta.36",
  );
  if (!pinned)
    throw new Error(
      "Pinned browser beta.36 is missing; run npm run fetch-bin with the agent cache configured",
    );
  options.executablePath = join(pinned.path, "camoufox-bin");
  const identityFile = join(profileDir, "identity.json");
  const current = Object.fromEntries(
    Object.entries(options.env || {}).filter(([k]) => /^CAMOU_CONFIG_/.test(k)),
  );
  if (existsSync(identityFile)) {
    for (const k of Object.keys(options.env))
      if (/^CAMOU_CONFIG_/.test(k)) delete options.env[k];
    const savedIdentity = JSON.parse(readFileSync(identityFile, "utf8"));
    if (savedIdentity.browser !== "156.0.1-beta.36")
      throw new Error(
        "Profile browser version differs; migrate a copy before opening it",
      );
    Object.assign(options.env, savedIdentity.environment);
  } else {
    writeFileSync(
      `${identityFile}.tmp`,
      JSON.stringify({ browser: "156.0.1-beta.36", environment: current }),
      { mode: 0o600 },
    );
    renameSync(`${identityFile}.tmp`, identityFile);
  }
  const context = await Camoufox({
    persistent_context: true,
    from_options: {
      ...options,
      viewport: null,
      firefoxUserPrefs: {
        ...options.firefoxUserPrefs,
        // newPage() creates native windows on beta.36. Keeping empty windows
        // open makes every page.close() spawn an untracked about:newtab page.
        "browser.tabs.closeWindowWithLastTab": true,
      },
      user_data_dir: join(profileDir, "firefox"),
    },
  });
  // A native profile cannot be replaced inside this worker. Let the supervisor
  // restore the last checkpoint if Firefox exits unexpectedly.
  context.once("close", () => setTimeout(() => process.exit(0), 1000).unref());
  const browser = context.browser();
  let claimed = false;
  browser.newContext = async (opts) => {
    if (claimed)
      throw new Error("A persistent worker owns exactly one profile context");
    claimed = true;
    const imported = join(profileDir, "import-storage.json");
    if (existsSync(imported)) {
      await context.setStorageState(imported);
      renameSync(imported, join(profileDir, "import-storage.completed.json"));
    }
    return context;
  };
  return browser;
}
