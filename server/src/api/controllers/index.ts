import type { BaseController } from '@mariachi/api-facade';
import type { CommunicationLayer } from '@mariachi/communication';
import type { Operation } from '../../../../src/contracts/operations';
import { McpController } from './mcp.controller';
import { OperationsController } from './operations.controller';

export function createControllers(communication: CommunicationLayer, operations: Operation[], server: { name: string; version: string }): BaseController[] {
  return [new OperationsController(communication, operations), new McpController(communication, operations, server)];
}
