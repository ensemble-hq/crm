import { BaseController } from '@mariachi/api-facade';
import { z } from 'zod';
import { CALL_WORKFLOW, RECEIVE_EMAIL, callWorkflowInput } from '../../services/index';

/**
 * Where an email provider delivers mail: `POST /api/inbound/email`, signed with the shared secret.
 * The message is stored before this answers. Any failure answers with an error, so the provider
 * keeps the message and tries again; a message delivered twice is stored once.
 */
const delivery = z.object({
  /** The provider's own id for this message. */
  id: z.string().min(1),
  from: z.object({ email: z.string().email(), name: z.string().optional() }),
  to: z.string().optional(),
  subject: z.string().default(''),
  text: z.string().default(''),
  messageId: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
  receivedAt: z.string().optional(),
});

/**
 * Where another system sets a workflow off: `POST /api/hooks/<the workflow's address>` with a JSON
 * body naming the record. The address is the credential. The answer says whether the workflow ran
 * and, if not, why.
 */
export class HooksController extends BaseController {
  readonly prefix = 'hooks';
  readonly tags = ['hooks'];

  init(): void {
    this.post('/:token', { auth: false, schema: { params: z.object({ token: z.string() }), body: callWorkflowInput.shape.body, response: z.object({ ran: z.boolean(), reason: z.string().optional() }) }, summary: 'Set a workflow off from another system' }, (ctx, body, params) =>
      this.call(ctx, CALL_WORKFLOW, { token: (params as { token: string }).token, body }),
    );
  }
}

export class InboundController extends BaseController {
  readonly prefix = 'inbound';
  readonly tags = ['inbound'];

  constructor(
    communication: ConstructorParameters<typeof BaseController>[0],
    private readonly provider: string,
  ) {
    super(communication);
  }

  init(): void {
    // What a mail app's own "unsubscribe" button calls (one-click unsubscribe, RFC 8058): a POST to the address in the List-Unsubscribe header.
    this.post('/unsubscribe/:token', { auth: false, schema: { params: z.object({ token: z.string() }) }, summary: 'One-click unsubscribe from a mail app' }, async (ctx, _body, params) => {
      await this.call(ctx, 'email.unsubscribe', { token: (params as { token: string }).token });
      return undefined;
    });

    this.post('/email', { auth: 'inbound', schema: { body: delivery, response: z.object({ status: z.enum(['stored', 'duplicate']) }) }, summary: 'Receive an email from the provider' }, (ctx, body) => {
      const mail = body as z.infer<typeof delivery>;
      return this.call(ctx, RECEIVE_EMAIL, {
        provider: this.provider,
        providerMessageId: mail.id,
        payload: { fromEmail: mail.from.email, fromName: mail.from.name, toEmail: mail.to, subject: mail.subject, text: mail.text, messageId: mail.messageId, inReplyTo: mail.inReplyTo, references: mail.references, receivedAt: mail.receivedAt },
      });
    });
  }
}
