// Library entry point. The CLI (daily-dispatch podcast make) is built from
// these same pieces; see README.md for how they fit together.
export type { Story, Turn, Segment, Script, SpeakerRole, VoiceEntry, VoiceMap } from './types.ts';
export { DispatchError, isDispatchError } from './errors.ts';
export type { ErrorKind } from './errors.ts';
export type { Env, ProviderContext } from './context.ts';

export { parseScript, formatScript, stripTags } from './script/parse.ts';
export { buildPrompt, cleanModelOutput } from './script/prompt.ts';
export { STYLE_GUIDE } from './script/style-guide.ts';
export { parseStories, prepareStories } from './stories.ts';
export { parseVoiceMap, roleOf, placeholderVoices } from './voices-file.ts';

export { textWriter } from './writers/types.ts';
export type { ScriptWriter, WriterInfo, WriteRequest, Prompt, Complete, WriterFactory } from './writers/types.ts';
export { WRITERS, getWriter } from './writers/registry.ts';
export { createAnthropicWriter } from './writers/anthropic.ts';
export { createOpenAIWriter } from './writers/openai.ts';
export { createOllamaWriter } from './writers/ollama.ts';
export { createCommandWriter, splitCommand } from './writers/command.ts';

export { effectiveCapabilities } from './voices/types.ts';
export type { VoiceProvider, VoiceCapabilities, SynthesisRequest, SynthesisResult, VoiceFactory } from './voices/types.ts';
export { VOICES, getVoiceProvider } from './voices/registry.ts';
export { createElevenLabsVoice } from './voices/elevenlabs.ts';
export { createOpenAIVoice } from './voices/openai.ts';
export { createGoogleVoice } from './voices/google.ts';
export { createPollyVoice } from './voices/polly.ts';
export { createAzureVoice } from './voices/azure.ts';
export { createLocalVoice, DEFAULT_LOCAL_TTS_URL } from './voices/local.ts';
export { signV4 } from './voices/sigv4.ts';
export type { AwsCredentials, SignableRequest } from './voices/sigv4.ts';

export { planChunks, filterTags } from './audio/chunk.ts';
export type { Chunk } from './audio/chunk.ts';
export { synthesizeChunks, chunkHash } from './audio/cache.ts';
export type { ChunkAudio } from './audio/cache.ts';
export { assembleEpisode } from './audio/assemble.ts';
export { createFfmpeg } from './audio/ffmpeg.ts';
export type { Ffmpeg } from './audio/ffmpeg.ts';
export { renderTranscript } from './audio/transcript.ts';

export { makePodcast } from './podcast.ts';
export type { MakeOptions, MakeResult } from './podcast.ts';
export { writerCost, formatUsd } from './estimate.ts';
export type { Estimate } from './estimate.ts';

// For adapter authors: the shared HTTP helpers every built-in adapter uses.
export { sendJson, readJson, readAudio, requireKey } from './http.ts';
export type { HttpOptions, JsonRequest } from './http.ts';
