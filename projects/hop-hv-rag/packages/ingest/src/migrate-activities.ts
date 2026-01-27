import {
  createDb,
  activities,
  activityVariants,
  videoToActivities,
  sceneToActivities,
  videos,
  scenes,
} from '@hop-hv-rag/db';
import { ActivityService } from '@hop-hv-rag/core';
import { join } from 'node:path';

const DATA_DIR = join(import.meta.dir, '../../../data');
const REGISTRY_PATH = join(DATA_DIR, 'activity-registry.json');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

async function main() {
  const db = createDb(DB_PATH);
  const activityService = new ActivityService(REGISTRY_PATH);
  await activityService.load();

  console.log('Populating Activities and Variants...');

  // 1. Unique Canonical Names
  const canonicalNames = activityService.getAllCanonicalNames();
  const canonicals = new Map<string, { id: number; type: string }>();

  for (const name of canonicalNames) {
    const entry = activityService.resolve(name);

    // Skip DISCARD entries
    if (entry.category === 'DISCARD') continue;

    const [activity] = await db
      .insert(activities)
      .values({
        name: entry.canonical,
        type: entry.category,
      })
      .onConflictDoUpdate({
        target: activities.name,
        set: { type: entry.category },
      })
      .returning();

    canonicals.set(entry.canonical, { id: activity.id, type: activity.type });
  }

  // Populate variants
  if (await Bun.file(REGISTRY_PATH).exists()) {
    const registry = await Bun.file(REGISTRY_PATH).json();
    for (const [raw, data] of Object.entries(registry)) {
      const entry = data as { canonical: string; category: string };
      if (entry.category === 'DISCARD') continue;

      const activityInfo = canonicals.get(entry.canonical);
      if (activityInfo) {
        await db
          .insert(activityVariants)
          .values({
            activityId: activityInfo.id,
            rawName: raw,
          })
          .onConflictDoNothing();
      }
    }
  }

  console.log(`Populated ${canonicals.size} canonical activities.`);

  // 2. Link Videos
  console.log('Linking Videos...');
  const allVideos = await db.select().from(videos);
  for (const video of allVideos) {
    if (!video.activities) continue;
    let acts: string[] = [];
    try {
      acts = JSON.parse(video.activities);
    } catch (e) {
      acts = [video.activities];
    }
    const canonicalsToLink = activityService.getCanonicalNames(acts);

    for (const canon of canonicalsToLink) {
      const activityInfo = canonicals.get(canon);
      if (activityInfo) {
        await db
          .insert(videoToActivities)
          .values({
            videoId: video.id,
            activityId: activityInfo.id,
          })
          .onConflictDoNothing();
      }
    }
  }

  // 3. Link Scenes
  console.log('Linking Scenes...');
  const allScenes = await db.select().from(scenes);
  for (const scene of allScenes) {
    if (!scene.activities) continue;
    let acts: string[] = [];
    try {
      acts = JSON.parse(scene.activities);
    } catch (e) {
      acts = [scene.activities];
    }
    const canonicalsToLink = activityService.getCanonicalNames(acts);

    for (const canon of canonicalsToLink) {
      const activityInfo = canonicals.get(canon);
      if (activityInfo) {
        await db
          .insert(sceneToActivities)
          .values({
            sceneId: scene.id,
            activityId: activityInfo.id,
          })
          .onConflictDoNothing();
      }
    }
  }

  console.log('Migration complete!');
}

main().catch(console.error);
