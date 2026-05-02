import { readJson, writeJson } from "@/lib/server/store";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/aiDefaults";

const FILE = "ai-settings.json";

export interface AiSettings {
  systemPrompt: string;
}

export function readAiSettings(): AiSettings {
  const data = readJson<Partial<AiSettings>>(FILE, {});
  return {
    systemPrompt: (data.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT).trim(),
  };
}

export function writeAiSettings(settings: AiSettings) {
  writeJson(FILE, settings);
}
