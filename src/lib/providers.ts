/** Gateways the app can talk to. All are OpenAI-compatible. */
export const GATEWAYS = [
  {
    id: "omniroute",
    name: "OmniRoute",
    defaultBaseUrl: "http://localhost:20128/v1",
    hint: "Local AI router. Find your key in the OmniRoute dashboard under Endpoints.",
  },
  {
    id: "openai",
    name: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    hint: "Use a key from platform.openai.com.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    hint: "Use a key from openrouter.ai/keys.",
  },
  {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    defaultBaseUrl: "",
    hint: "Any endpoint exposing /chat/completions.",
  },
] as const;

export type GatewayId = (typeof GATEWAYS)[number]["id"];

export function getGateway(id: string) {
  return GATEWAYS.find((g) => g.id === id) ?? GATEWAYS[0];
}
