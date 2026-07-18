import { transcribe } from "ai";

/**
 * Transcribe a publicly reachable audio URL (Wassist-hosted voice note).
 * Returns trimmed text, or null when transcription fails / is empty.
 */
export async function transcribeAudioUrl(
  audioUrl: string,
): Promise<string | null> {
  try {
    const { text } = await transcribe({
      model: process.env.EVE_TRANSCRIBE_MODEL ?? "openai/whisper-1",
      audio: new URL(audioUrl),
    });
    const trimmed = text.trim();
    return trimmed || null;
  } catch (err) {
    console.error("[transcribe] failed", err);
    return null;
  }
}
