// Shared application error registry for the agent platform. Legacy tab routes
// retain upstream errors; platform errors are projected identically in REST/MCP.
export const ERROR_CODES = {
  stale_refs: 422,
  invalid_selector: 400,
  read_timeout: 408,
  capture_not_found: 404,
  capture_output_collision: 409,
  capture_resume_required: 409,
  operation_not_found: 404,
  operation_expired: 409,
  operation_generation: 409,
  operation_limit: 429,
  idempotency_conflict: 409,
  automation_paused: 409,
  ambiguous_target: 409,
  target_changed: 409,
  focus_changed: 409,
  typing_mismatch: 409,
  invalid_request: 400,
  invalid_country: 400,
  invalid_target: 400,
  invalid_click_target: 400,
  invalid_coordinates: 400,
  profile_not_found: 404,
  session_not_found: 404,
  tab_not_found: 404,
  profile_exists: 409,
  profile_busy: 409,
  session_owned: 409,
  session_busy: 409,
  session_suspended: 409,
  human_control: 409,
  viewer_busy: 409,
  viewer_not_connected: 409,
  handoff_expired: 409,
  viewer_unauthorized: 403,
  viewer_failed: 503,
  desktop_unavailable: 503,
  stale_observation: 409,
  click_outcome_unknown: 409,
  operation_cancelled: 409,
  operation_outcome_unknown: 409,
  country_unavailable: 422,
  vpn_connection_limit: 429,
  locate_failed: 502,
  worker_error: 503,
  worker_failed: 503,
  worker_timeout: 503,
  proton_timeout: 503,
  proton_login_required: 503,
  proton_unavailable: 503,
  proton_provider_error: 503,
  vpn_helper_permission_denied: 503,
  vpn_helper_failed: 503,
  vpn_handshake_failed: 503,
  internal_error: 500,
};
export const problemSchema = {
  type: "object",
  required: ["type", "title", "status", "detail", "code", "retryable"],
  properties: {
    type: { type: "string" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    code: { type: "string", enum: Object.keys(ERROR_CODES) },
    retryable: { type: "boolean" },
  },
  additionalProperties: false,
};
export function applicationProblem(error) {
  const code = Object.hasOwn(ERROR_CODES, error.code)
    ? error.code
    : "internal_error";
  const status = error.statusCode || ERROR_CODES[code];
  return {
    type: `urn:camofox:error:${code}`,
    title: code.replaceAll("_", " "),
    status,
    detail:
      code === "internal_error"
        ? "Internal error; inspect service logs"
        : error.message,
    code,
    retryable: false,
  };
}
