export * as MeshProvider from "./mesh"

import { ConfigV1 } from "@opencode-ai/core/v1/config/config"

/**
 * Mesh-LLM fork: OpenCode ships with a Mesh provider so a locally running
 * mesh-llm endpoint is usable with no configuration at all.
 *
 * The entry is seeded *beneath* the user's own config, so an explicit
 * `provider["mesh-llm"]` block always wins, and it fails soft: model ids are
 * discovered from the mesh's OpenAI-compatible `/v1/models` endpoint, and a
 * provider with no models is dropped, so when no mesh answers the provider does
 * not appear at all and stock OpenCode behaviour is unchanged.
 *
 * Point OpenCode at a mesh that is not on the default local port with:
 *
 *     MESH_LLM_BASE_URL=http://other-host:9337/v1
 *
 * Setting that variable to an empty string turns the seeded provider off.
 */
export type ConfigProvider = NonNullable<ConfigV1.Info["provider"]>[string]
export type ConfigProviderModel = NonNullable<ConfigProvider["models"]>[string]

export const ID = "mesh-llm"
export const NAME = "Mesh LLM"
export const BASE_URL_ENV = "MESH_LLM_BASE_URL"
export const BASE_URL_DEFAULT = "http://127.0.0.1:9337/v1"

/**
 * mesh-llm's own agent launchers hand OpenCode these limits, because the mesh's
 * `/v1/models` listing does not carry per-model context windows yet. They are
 * only a starting point: a user can still declare a model explicitly under the
 * same provider id and that entry wins.
 */
export const CONTEXT_LIMIT_DEFAULT = 32_768
export const OUTPUT_LIMIT_DEFAULT = 4_096

export function providerConfig(env: Record<string, string | undefined>): ConfigProvider | undefined {
  const baseURL = env[BASE_URL_ENV]
  if (baseURL === "") return undefined
  return {
    name: NAME,
    npm: "@ai-sdk/openai-compatible",
    options: {
      baseURL: baseURL || BASE_URL_DEFAULT,
      apiKey: "dummy",
      dynamicModels: true,
    },
  }
}

export function discoveredModel(): ConfigProviderModel {
  return { limit: { context: CONTEXT_LIMIT_DEFAULT, output: OUTPUT_LIMIT_DEFAULT } }
}
