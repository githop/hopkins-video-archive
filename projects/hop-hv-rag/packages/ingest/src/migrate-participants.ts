import {
  createDb,
  people,
  peopleVariants,
  videoToPeople,
  sceneToPeople,
  videos,
  scenes,
} from '@hop-hv-rag/db';
import { ParticipantService } from '@hop-hv-rag/core';
import { join } from 'node:path';

const DATA_DIR = join(import.meta.dir, '../../../data');
const REGISTRY_PATH = join(DATA_DIR, 'participant-registry.json');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

async function main() {
  const db = createDb(DB_PATH);
  const participantService = new ParticipantService(REGISTRY_PATH);
  await participantService.load();

  console.log('Populating People and Variants...');

  // 1. Unique Canonical Names
  const canonicalNames = participantService.getAllCanonicalNames();
  const canonicals = new Map<string, { id: number; type: string }>();

  for (const name of canonicalNames) {
    // We need the category from the registry, so we look up a variant
    // This is slightly inefficient but keeps the service clean.
    // In a real app we'd iterate over the registry entries directly.
    const entry = participantService.resolve(name);

    const [person] = await db
      .insert(people)
      .values({
        name: entry.canonical,
        type: entry.category,
      })
      .onConflictDoUpdate({
        target: people.name,
        set: { type: entry.category },
      })
      .returning();

    canonicals.set(entry.canonical, { id: person.id, type: person.type });
  }

  // Populate variants
  const registry = await Bun.file(REGISTRY_PATH).json();
  for (const [raw, data] of Object.entries(registry)) {
    const entry = data as any;
    if (entry.category === 'DISCARD') continue;

    const personInfo = canonicals.get(entry.canonical);
    if (personInfo) {
      await db
        .insert(peopleVariants)
        .values({
          personId: personInfo.id,
          rawName: raw,
        })
        .onConflictDoNothing();
    }
  }

  console.log(`Populated ${canonicals.size} canonical people/roles.`);

  // 2. Link Videos
  console.log('Linking Videos...');
  const allVideos = await db.select().from(videos);
  for (const video of allVideos) {
    if (!video.participants) continue;
    const parts = JSON.parse(video.participants) as string[];
    const canonicalsToLink = participantService.getCanonicalNames(parts);

    for (const canon of canonicalsToLink) {
      const personInfo = canonicals.get(canon);
      if (personInfo) {
        await db
          .insert(videoToPeople)
          .values({
            videoId: video.id,
            personId: personInfo.id,
          })
          .onConflictDoNothing();
      }
    }
  }

  // 3. Link Scenes
  console.log('Linking Scenes...');
  const allScenes = await db.select().from(scenes);
  for (const scene of allScenes) {
    if (!scene.participants) continue;
    const parts = JSON.parse(scene.participants) as string[];
    const canonicalsToLink = participantService.getCanonicalNames(parts);

    for (const canon of canonicalsToLink) {
      const personInfo = canonicals.get(canon);
      if (personInfo) {
        await db
          .insert(sceneToPeople)
          .values({
            sceneId: scene.id,
            personId: personInfo.id,
          })
          .onConflictDoNothing();
      }
    }
  }

  console.log('Migration complete!');
}

main().catch(console.error);
