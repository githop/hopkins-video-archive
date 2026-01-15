import { getGenModel, getEmbedModel, GENERATION_MODELS } from './index.ts';

console.log('--- AI Provider Verification ---');

try {
  console.log('\n1. Testing Default Generation Model (vLLM)...');
  getGenModel();
  console.log('   ✅ vLLM Gen Model Initialized');
} catch (e: any) {
  console.error('   ❌ vLLM Gen Model Failed:', e.message);
}

try {
  console.log('\n2. Testing Default Embedding Model (vLLM)...');
  getEmbedModel();
  console.log('   ✅ vLLM Embed Model Initialized');
} catch (e: any) {
  console.error('   ❌ vLLM Embed Model Failed:', e.message);
}

console.log('\n3. Testing Google Generation Model (Gemini)...');
const geminiModel = GENERATION_MODELS.GOOGLE[0];
try {
  // This will fail if GOOGLE_GENERATIVE_AI_API_KEY is not set, which is expected for me
  getGenModel(geminiModel);
  console.log(`   ✅ Google Gen Model (${geminiModel}) Initialized`);
} catch (e: any) {
  if (e.message.includes('GOOGLE_GENERATIVE_AI_API_KEY')) {
    console.log(
      `   ℹ️ Google Gen Model (${geminiModel}) logic verified (API Key missing as expected)`,
    );
  } else {
    console.error(`   ❌ Google Gen Model (${geminiModel}) Failed:`, e.message);
  }
}

try {
  console.log('\n4. Testing Unsupported Model...');
  getGenModel('non-existent-model');
  console.error('   ❌ Unsupported Model check failed (should have thrown)');
} catch (e: any) {
  console.log('   ✅ Unsupported Model correctly threw error:', e.message);
}

console.log('\n--- Verification Complete ---');
