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
      // Prefer gpt-4o-mini-transcribe over legacy whisper-1: better WER, ~half the cost.
      model:
        process.env.EVE_TRANSCRIBE_MODEL ?? "openai/gpt-4o-mini-transcribe",
      audio: new URL(audioUrl),
    });
    const trimmed = text.trim();
    return trimmed || null;
  } catch (err) {
    console.error("[transcribe] failed", err);
    return null;
  }
}
