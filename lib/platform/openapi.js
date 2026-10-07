import {browserOperation,operationSchema,pendingOperationSchema,retryKeySchema,openApiSchema} from '../../mcp/lib/operation-contracts.mjs';
// The supervised gateway exposes tab operations plus the platform descriptors.
// Upstream singleton /browser and destructive /sessions routes are not routed.
export function agentSpec(source) {
  const spec = structuredClone(source);
  spec.info.title = "Camofox agent platform";
  spec.info.description =
    "Named persistent profiles, resumable sessions, Proton routing, authenticated human login and inspected visual targets.";
  spec.servers = [
    { url: "http://127.0.0.1:23058", description: "Local agent service" },
  ];
  spec.paths = Object.fromEntries(
    Object.entries(spec.paths).filter(
      ([path]) =>
        /^\/(?:tabs(?:\/|$)|profiles$|operations(?:\/|$)|agent-sessions(?:\/|$)|vpn\/|observations\/|viewer(?:$|\/)|health$)/.test(
          path,
        ) || /^\/sessions\/\{userId\}\/(?:cookies|storage_state)$/.test(path),
    ),
  );
  for (const [path, methods] of Object.entries(spec.paths))
    for (const [method, op] of Object.entries(methods)) {
      if (!["get", "post", "put", "delete", "patch"].includes(method)) continue;
      if (path !== "/health" && !path.startsWith("/viewer")) op.security = [{ AccessKeyAuth: [] }];
      const policy=browserOperation(method.toUpperCase(),path.replaceAll(/\{[^}]+\}/g,'id'));
      if(policy?.mutation || (method==='get'&&path.endsWith('/downloads'))) {
        op.description=(op.description||'')+' Supervised mutations wait up to two seconds and then return 202 pending. Inspect operation status; do not replay to recover a missing result.';
        op.responses[202]={description:'Accepted and still pending',content:{'application/json':{schema:{$ref:'#/components/schemas/PendingOperation'}}}};
        for(const [code,response] of Object.entries(op.responses))if(code!=='202'&&response.content?.['application/json']?.schema?.type==='object')response.content['application/json'].schema.properties={...response.content['application/json'].schema.properties,operation:{$ref:'#/components/schemas/Operation'}};
        if(method==='get'||method==='delete')(op.parameters||=[]).push({name:'idempotencyKey',in:'query',schema:retryKeySchema});
        else if(op.requestBody?.content?.['application/json']?.schema?.properties)op.requestBody.content['application/json'].schema.properties.idempotencyKey=retryKeySchema;
        op['x-agent-notes']={...op['x-agent-notes'],sideEffects:'Browser mutation; cancellation can leave partial effects.',consistency:{refresh:'Inspect operation status, then obtain a fresh snapshot before retrying.'}};
      }
      if(path==='/tabs/{tabId}/type'&&method==='post')op.requestBody.content['application/json'].schema.properties.mode.default='paced';
      if (["/tabs", "/tabs/open", "/tabs/group/{listItemId}"].includes(path)) {
        const field = {
          type: "string",
          description:
            "Saved session identifier; omit to use the stable default session for this adapter identity.",
        };
        if (method === "get" || method === "delete")
          (op.parameters ||= []).push({ name: "sessionId", in: "query", schema: field });
        else if (
          op.requestBody?.content?.["application/json"]?.schema?.properties
        )
          op.requestBody.content[
            "application/json"
          ].schema.properties.sessionId = field;
      }
    }
  spec.paths["/health"] = {
    get: {
      operationId: "camofox_health",
      tags: ["System"],
      summary: "Service liveness",
      responses: {
        200: {
          description: "Service is ready",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["ok", "service", "browser", "activeSessions"],
                properties: {
                  ok: { type: "boolean" },
                  service: { type: "string" },
                  browser: { type: "string" },
                  activeSessions: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
  };
  return spec;
}
