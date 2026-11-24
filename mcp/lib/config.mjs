import os from 'node:os';
import { join } from 'node:path';
import { analysisInference } from './analysis-contracts.mjs';
import { validateCaptureValue } from './capture-contracts.mjs';

function imageAnalysisDefaults(env) {
  const model = env.CAMOFOX_ANALYSIS_MODEL?.trim();
  const provider = env.CAMOFOX_ANALYSIS_PROVIDER?.trim();
  if (model === undefined && provider === undefined) return undefined;
  validateCaptureValue(model, analysisInference.properties.model, 'CAMOFOX_ANALYSIS_MODEL');
  if (provider !== undefined) {
    validateCaptureValue(provider, analysisInference.properties.provider, 'CAMOFOX_ANALYSIS_PROVIDER');
  }
  return { mode: 'custom', model, ...(provider ? { provider } : {}) };
}

/**
 * Load only the environment settings the standalone MCP adapter requires.
 * This module intentionally does not import the core server configuration so
 * @askjo/camofox-browser-mcp can run without the core package installed.
 */
export function loadMcpConfig(env = process.env) {
  return {
    port: parseInt(env.CAMOFOX_PORT || env.PORT || '9377', 10),
    apiKey: env.CAMOFOX_API_KEY || '',
    accessKey: (env.CAMOFOX_ACCESS_KEY || '').trim(),
    cookiesDir: env.CAMOFOX_COOKIES_DIR || join(os.homedir(), '.camofox', 'cookies'),
    analysisInference: imageAnalysisDefaults(env),
  };
}
