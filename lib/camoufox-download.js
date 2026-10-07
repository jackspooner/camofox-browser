import { CamoufoxFetcher } from '@camoufox/camoufox';
import { pathToFileURL } from 'node:url';
export const BUNDLED_CAMOUFOX_RELEASE = '156.0.1-beta.36';
export class CompatibleCamoufoxFetcher extends CamoufoxFetcher {
  checkAsset(asset, release) {
    if (!asset.name.startsWith(`camoufox-${BUNDLED_CAMOUFOX_RELEASE}-`)) return null;
    return super.checkAsset(asset, release);
  }
}
export async function downloadBundledCamoufox({ createFetcher = () => new CompatibleCamoufoxFetcher() } = {}) {
  const fetcher = createFetcher();
  await fetcher.init();
  await fetcher.install();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  downloadBundledCamoufox().catch(error => { console.error(error); process.exitCode = 1; });
}
