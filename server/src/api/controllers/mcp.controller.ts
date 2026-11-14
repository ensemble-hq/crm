import { BaseController, httpResponse } from '@mariachi/api-facade';
import type { CommunicationLayer } from '@mariachi/communication';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Operation } from '../../../../src/contracts/operations';

/**
 * The CRM as an MCP server, at `POST /api/mcp`: every operation is a tool an agent can call. It is
 * the stateless form of MCP's HTTP transport: each request is one JSON-RPC message answered with
 * JSON, signed in the same way as any other request, so an agent has exactly its person's access.
 */

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST = PROTOCOL_VERSIONS[0] as string;

type Tool = { operation: Operation; name: string; wrapped: boolean; inputSchema: Record<string, unknown> };

function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const { $schema: _draft, ...rest } = zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>;
  return rest;
}

/** MCP tools take an object. An operation whose input is a single value (an id) takes it as `{ "input": value }`. */
function toTool(operation: Operation): Tool {
  const name = operation.name.replace(/\./g, '_');
  if (operation.input instanceof z.ZodUndefined) return { operation, name, wrapped: false, inputSchema: { type: 'object', properties: {}, additionalProperties: false } };
  if (operation.input instanceof z.ZodObject) return { operation, name, wrapped: false, inputSchema: jsonSchema(operation.input) };
  return { operation, name, wrapped: true, inputSchema: { type: 'object', properties: { input: jsonSchema(operation.input) }, required: operation.input.isOptional() ? [] : ['input'], additionalProperties: false } };
}

const requestSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]).optional(), method: z.string(), params: z.record(z.unknown()).optional() });

export class McpController extends BaseController {
  readonly prefix = 'mcp';
  readonly tags = ['mcp'];
  private readonly tools: Tool[];

  constructor(
    communication: CommunicationLayer,
    operations: Operation[],
    private readonly server: { name: string; version: string },
  ) {
    super(communication);
    this.tools = operations.map(toTool);
  }

  init(): void {
    this.post('/', { schema: { body: requestSchema }, summary: 'MCP endpoint (JSON-RPC)' }, async (ctx, body) => {
      const request = body as z.infer<typeof requestSchema>;
      // A notification has no id and gets no answer.
      if (request.id === undefined) return httpResponse(202, undefined);
      const answer = (result: unknown) => ({ jsonrpc: '2.0', id: request.id, result });
      const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: request.id, error: { code, message } });

      switch (request.method) {
        case 'initialize': {
          const asked = typeof request.params?.protocolVersion === 'string' ? request.params.protocolVersion : LATEST;
          return answer({
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST,
            capabilities: { tools: { listChanged: false } },
            serverInfo: this.server,
            instructions: 'This is a CRM. Call workspace_get first: it lists the objects, their properties and the ids every other tool takes. Tools marked destructive remove data; ask the person before calling them.',
          });
        }
        case 'ping':
          return answer({});
        case 'tools/list':
          return answer({
            tools: this.tools.map((tool) => ({
              name: tool.name,
              title: tool.operation.title,
              description: tool.operation.description,
              inputSchema: tool.inputSchema,
              annotations: { title: tool.operation.title, readOnlyHint: tool.operation.effect === 'read', destructiveHint: tool.operation.effect === 'destructive', openWorldHint: tool.operation.effect === 'send' },
            })),
          });
        case 'tools/call': {
          const tool = this.tools.find((item) => item.name === request.params?.name);
          if (!tool) return fail(-32602, `Unknown tool: ${String(request.params?.name)}`);
          const given = (request.params?.arguments ?? {}) as Record<string, unknown>;
          const input = tool.operation.input instanceof z.ZodUndefined ? undefined : tool.wrapped ? given.input : given;
          try {
            const result = await this.call(ctx, tool.operation.name, input);
            return answer({ content: [{ type: 'text', text: JSON.stringify(result ?? null) }], isError: false });
          } catch (error) {
            // A failed tool call is a result the agent can read and act on, not a protocol error.
            return answer({ content: [{ type: 'text', text: error instanceof Error ? error.message : 'The operation failed.' }], isError: true });
          }
        }
        default:
          return fail(-32601, `Method not found: ${request.method}`);
      }
    });
  }
}
