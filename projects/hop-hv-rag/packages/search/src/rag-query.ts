import { sql, inArray } from 'drizzle-orm';
import {
  createDb,
  type Scene,
  people,
  locations,
  sceneToPeople,
  sceneToLocations,
} from '@hop-hv-rag/db';
import { join } from 'node:path';
import { ParticipantService, LocationService } from '@hop-hv-rag/core';
import { getEmbedModel, getGenModel } from '@hop-hv-rag/ai';
import {
  generateText,
  embed,
  type LanguageModel,
  type EmbeddingModel,
} from 'ai';

/**
 * Configuration
 */
const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');
const REGISTRY_PATH = join(DATA_DIR, 'participant-registry.json');
const LOCATION_REGISTRY_PATH = join(DATA_DIR, 'location-registry.json');

export interface HybridResult extends Scene {
  videoTitle: string;
  videoYear: number;
  videoParticipants: string;
  videoLocations: string;
  videoDriveFileId: string;
  canonicalParticipants?: string;
  canonicalLocations?: string;
  score?: number;
}

/**
 * FamilyArchivist: Handles hybrid search and RAG synthesis.
 */
export class FamilyArchivist {
  private db: ReturnType<typeof createDb>;
  private participantService: ParticipantService;
  private locationService: LocationService;

  constructor(
    private genModel: LanguageModel,
    private embedModel: EmbeddingModel,
  ) {
    this.db = createDb(DB_PATH);
    this.participantService = new ParticipantService(REGISTRY_PATH);
    this.locationService = new LocationService(LOCATION_REGISTRY_PATH);
  }

  async init() {
    await Promise.all([
      this.participantService.load(),
      this.locationService.load(),
    ]);
  }

  async ask(query: string): Promise<string> {
    console.log(`🤖 Consulting the Family Archivist for: "${query}"...`);

    // 1. Detect Entities in Query
    const [detectedPeople, detectedLocations] = await Promise.all([
      this.detectPeople(query),
      this.detectLocations(query),
    ]);

    if (detectedPeople.length > 0) {
      console.log(
        `   👤 Detected people: ${detectedPeople.map((p) => p.name).join(', ')}`,
      );
    }
    if (detectedLocations.length > 0) {
      console.log(
        `   📍 Detected locations: ${detectedLocations.map((l) => l.name).join(', ')}`,
      );
    }

    const results = await this.hybridSearch(
      query,
      detectedPeople.map((p) => p.id),
      detectedLocations.map((l) => l.id),
    );

    if (results.length === 0) {
      const msg = 'No relevant scenes found in the archive.';
      console.log(msg);
      return msg;
    }

    console.log(
      `   📊 Found ${results.length} relevant scenes. Synthesizing answer...`,
    );

    const context = await this.formatContext(results);
    console.log(context); // Avoid excessive console logs during eval
    const answer = await this.synthesize(query, context);

    console.log('\n--- 🤖 Archivist Response ---\n');
    console.log(answer);
    console.log('\n----------------------------\n');

    return answer;
  }

  private async detectPeople(query: string) {
    const names = this.participantService.detectParticipants(query);
    if (names.length === 0) return [];

    return await this.db
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(inArray(people.name, names))
      .all();
  }

  private async detectLocations(query: string) {
    const names = this.locationService.detectLocations(query);
    if (names.length === 0) return [];

    return await this.db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(inArray(locations.name, names))
      .all();
  }

  private async hybridSearch(
    query: string,
    personIds: number[],
    locationIds: number[],
  ): Promise<HybridResult[]> {
    // 1. Vector Search
    const { embedding } = await embed({
      model: this.embedModel,
      value: query,
    });
    const queryVecJson = JSON.stringify(embedding);

    const vectorSql = `
      SELECT 
        s.id,
        s.video_id as videoId,
        s.start_time as startTime,
        s.end_time as endTime,
        s.title,
        s.summary,
        s.transcript,
        v.title as videoTitle,
        v.year as videoYear,
        v.participants as videoParticipants,
        v.locations as videoLocations,
        v.drive_file_id as videoDriveFileId
      FROM (
        SELECT rowid, vec_distance_cosine(scene_embedding, '${queryVecJson}') as distance
        FROM vec_scenes
        ORDER BY distance ASC
        LIMIT 40
      ) m
      JOIN scenes s ON s.id = m.rowid
      JOIN videos v ON v.id = s.video_id
    `;

    // If person detected, we could filter or boost.
    // For now, let's keep it broad but use the IDs for ranking later if needed.
    const vectorResults = await this.db.all<HybridResult>(sql.raw(vectorSql));

    // 2. FTS5 Keyword Search
    const cleanQuery = query.replace(/[^\w\s]/g, ' ').trim();
    const ftsResults = await this.db.all<HybridResult>(
      sql.raw(`
      SELECT 
        s.id,
        s.video_id as videoId,
        s.start_time as startTime,
        s.end_time as endTime,
        s.title,
        s.summary,
        s.transcript,
        v.title as videoTitle,
        v.year as videoYear,
        v.participants as videoParticipants,
        v.locations as videoLocations,
        v.drive_file_id as videoDriveFileId
      FROM fts_scenes f
      JOIN scenes s ON s.id = f.id
      JOIN videos v ON v.id = s.video_id
      WHERE fts_scenes MATCH '${cleanQuery.replace(/'/g, "''")}'
      ORDER BY bm25(fts_scenes)
      LIMIT 40
    `),
    );

    // 3. Reciprocal Rank Fusion
    const fused = this.fuse(vectorResults, ftsResults);

    // 4. Re-rank/Filter based on people and locations if detected
    if (personIds.length > 0 || locationIds.length > 0) {
      // We'll give a slight boost to results that actually contain the detected person or location
      // in the junction tables
      for (const result of fused) {
        let boost = 1.0;

        if (personIds.length > 0) {
          const scenePeople = this.db
            .select({ personId: sceneToPeople.personId })
            .from(sceneToPeople)
            .where(sql`${sceneToPeople.sceneId} = ${result.id}`)
            .all();
          const hasPerson = scenePeople.some((sp) =>
            personIds.includes(sp.personId),
          );
          if (hasPerson) boost *= 1.5;
        }

        if (locationIds.length > 0) {
          const sceneLocations = this.db
            .select({ locationId: sceneToLocations.locationId })
            .from(sceneToLocations)
            .where(sql`${sceneToLocations.sceneId} = ${result.id}`)
            .all();
          const hasLocation = sceneLocations.some((sl) =>
            locationIds.includes(sl.locationId),
          );
          if (hasLocation) boost *= 1.5;
        }

        if (result.score) {
          result.score *= boost;
        }
      }
      return fused.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
    }

    return fused;
  }

  private fuse(
    vectorResults: HybridResult[],
    ftsResults: HybridResult[],
  ): HybridResult[] {
    const k = 60;
    const scores = new Map<number, number>();
    const resultMap = new Map<number, HybridResult>();

    [vectorResults, ftsResults].forEach((list) => {
      list.forEach((item, index) => {
        const currentScore = scores.get(item.id) || 0;
        scores.set(item.id, currentScore + 1 / (k + index + 1));
        resultMap.set(item.id, item);
      });
    });

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10) // Take top 10 for potential re-ranking
      .map(([id, score]) => ({ ...resultMap.get(id)!, score }));
  }

  private async formatContext(results: HybridResult[]): Promise<string> {
    const formatted = [];

    for (const r of results) {
      // Fetch canonical participants from the new junction table
      const canonicals = this.db
        .select({ name: people.name })
        .from(people)
        .innerJoin(sceneToPeople, sql`${sceneToPeople.personId} = ${people.id}`)
        .where(sql`${sceneToPeople.sceneId} = ${r.id}`)
        .all();

      // Fetch canonical locations from the new junction table
      const canonicalLocs = this.db
        .select({ name: locations.name })
        .from(locations)
        .innerJoin(
          sceneToLocations,
          sql`${sceneToLocations.locationId} = ${locations.id}`,
        )
        .where(sql`${sceneToLocations.sceneId} = ${r.id}`)
        .all();

      const p = canonicals.map((c) => c.name).join(', ') || 'None identified';
      const l =
        canonicalLocs.map((c) => c.name).join(', ') ||
        JSON.parse(r.videoLocations || '[]').join(', ');

      const minutes = Math.floor(r.startTime / 60);
      const seconds = Math.floor(r.startTime % 60);
      const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

      formatted.push(
        [
          `VIDEO: ${r.videoTitle}`,
          `DRIVE_ID: ${r.videoDriveFileId}`,
          `YEAR: ${r.videoYear || 'Unknown'}`,
          `TIMESTAMP: ${timeStr}`,
          `SCENE: ${r.title}`,
          `PARTICIPANTS (Normalized): ${p}`,
          `LOCATIONS (Normalized): ${l}`,
          `SUMMARY: ${r.summary}`,
          `TRANSCRIPT: ${r.transcript}`,
          `---`,
        ].join('\n'),
      );
    }

    return formatted.join('\n\n');
  }

  private async synthesize(query: string, context: string): Promise<string> {
    const { text } = await generateText({
      model: this.genModel,
      system: [
        'You are a professional Family Historian and Video Archivist.',
        "Analyze the provided archive fragments to answer the user's question.",
        'GUIDELINES:',
        '1. Use ONLY the provided context to answer the question.',
        "2. If the answer is not in the archive, say you don't have enough information.",
        '3. Be descriptive but concise.',
        '4. CITATIONS: You MUST cite sources using Markdown links.',
        '   - Use the specific timestamp from the TRANSCRIPT if available for maximum precision.',
        '   - Format: [Video Title @ MM:SS](https://drive.google.com/file/d/DRIVE_ID)',
        '   - Convert seconds from the transcript (e.g. [1079s]) to MM:SS format (e.g. 17:59).',
        '5. Synthesize information from multiple videos when applicable.',
      ].join('\n'),
      prompt: `CONTEXT FROM ARCHIVE:\n${context}\n\nUSER QUESTION: ${query}`,
    });
    return text;
  }
}

/**
 * CLI Entry Point
 */
async function main() {
  const query = Bun.argv.slice(2).join(' ');
  if (!query) {
    console.error('Usage: bun search:rag <your question>');
    process.exit(1);
  }

  // Use summarizer for both if not specified, based on project constraints
  const archivist = new FamilyArchivist(
    getGenModel('summarizer'),
    getEmbedModel('embed'),
  );

  await archivist.init();
  await archivist.ask(query);
}

if (import.meta.main) {
  main().catch(console.error);
}
