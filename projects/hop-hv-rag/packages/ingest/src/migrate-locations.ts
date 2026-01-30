import {
  createDb,
  locations,
  locationVariants,
  videoToLocations,
  sceneToLocations,
  videos,
  scenes,
} from '@hop-hv-rag/db';
import { LocationService, logger } from '@hop-hv-rag/core';
import { join } from 'node:path';

const DATA_DIR = join(import.meta.dir, '../../../data');
const REGISTRY_PATH = join(DATA_DIR, 'location-registry.json');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

async function main() {
  const db = createDb(DB_PATH);
  const locationService = new LocationService(REGISTRY_PATH);
  await locationService.load();

  logger.info({ phase: 'populate' }, 'Populating Locations and Variants...');

  // 1. Unique Canonical Names
  const canonicalNames = locationService.getAllCanonicalNames();
  const canonicals = new Map<string, { id: number; type: string }>();

  for (const name of canonicalNames) {
    const entry = locationService.resolve(name);

    const [location] = await db
      .insert(locations)
      .values({
        name: entry.canonical,
        type: entry.category,
      })
      .onConflictDoUpdate({
        target: locations.name,
        set: { type: entry.category },
      })
      .returning();

    canonicals.set(entry.canonical, { id: location.id, type: location.type });
  }

  // Populate variants
  if (await Bun.file(REGISTRY_PATH).exists()) {
    const registry = await Bun.file(REGISTRY_PATH).json();
    for (const [raw, data] of Object.entries(registry)) {
      const entry = data as any;
      if (entry.category === 'DISCARD') continue;

      const locationInfo = canonicals.get(entry.canonical);
      if (locationInfo) {
        await db
          .insert(locationVariants)
          .values({
            locationId: locationInfo.id,
            rawName: raw,
          })
          .onConflictDoNothing();
      }
    }
  }

  logger.info(
    { phase: 'populate', count: canonicals.size },
    `Populated ${canonicals.size} canonical locations/settings.`,
  );

  // 2. Link Videos
  logger.info({ phase: 'link_videos' }, 'Linking Videos...');
  const allVideos = await db.select().from(videos);
  for (const video of allVideos) {
    if (!video.locations) continue;
    let locs: string[] = [];
    try {
      locs = JSON.parse(video.locations);
    } catch (e) {
      locs = [video.locations];
    }
    const canonicalsToLink = locationService.getCanonicalNames(locs);

    for (const canon of canonicalsToLink) {
      const locationInfo = canonicals.get(canon);
      if (locationInfo) {
        await db
          .insert(videoToLocations)
          .values({
            videoId: video.id,
            locationId: locationInfo.id,
          })
          .onConflictDoNothing();
      }
    }
  }

  // 3. Link Scenes
  logger.info({ phase: 'link_scenes' }, 'Linking Scenes...');
  const allScenes = await db.select().from(scenes);
  for (const scene of allScenes) {
    if (!scene.locations) continue;
    let locs: string[] = [];
    try {
      locs = JSON.parse(scene.locations);
    } catch (e) {
      locs = [scene.locations];
    }
    const canonicalsToLink = locationService.getCanonicalNames(locs);

    for (const canon of canonicalsToLink) {
      const locationInfo = canonicals.get(canon);
      if (locationInfo) {
        await db
          .insert(sceneToLocations)
          .values({
            sceneId: scene.id,
            locationId: locationInfo.id,
          })
          .onConflictDoNothing();
      }
    }
  }

  logger.info({ phase: 'complete' }, 'Migration complete!');
}

main().catch((err) => {
  logger.error({ error: err }, 'Migration failed');
  process.exit(1);
});
