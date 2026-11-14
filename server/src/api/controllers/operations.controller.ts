import { BaseController } from '@mariachi/api-facade';
import type { CommunicationLayer } from '@mariachi/communication';
import { z } from 'zod';
import type { Operation } from '../../../../src/contracts/operations';

/** A file of a few hundred thousand cells. */
const LARGE_BODY_BYTES = 32 * 1024 * 1024;

/**
 * The HTTP API the web app calls: one route per operation, `POST /api/ops/<name>` with the
 * operation's input as `{ "input": … }`. Generated from the operation list, so it is never out of
 * step with it, and every route is in the OpenAPI document.
 */
export class OperationsController extends BaseController {
  readonly prefix = 'ops';
  readonly tags = ['operations'];

  constructor(
    communication: CommunicationLayer,
    private readonly operations: Operation[],
  ) {
    super(communication);
  }

  init(): void {
    for (const operation of this.operations) {
      this.post(`/${operation.name}`, { schema: { body: z.object({ input: operation.input }), response: operation.output }, summary: operation.title, description: operation.description, ...(operation.large ? { bodyLimitBytes: LARGE_BODY_BYTES } : {}) }, (ctx, body) => {
        return this.call(ctx, operation.name, (body as { input?: unknown }).input);
      });
    }
  }
}
