import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { LlmOutput, type ErrorDetails, type LlmCompletion, type LlmErrorCode, type LlmModel } from '@trailmap/shared';

export interface LlmProvider {
  complete(request: LlmCompletion): Promise<LlmOutput>;
  models(): Promise<LlmModel[]>;
}

type FailureReason = 'http_status' | 'auth_unavailable' | 'not_signed_in' | 'network_error' | 'deadline' | 'catalog_unavailable'
  | 'non_stream_response' | 'stream_ended_early' | 'stream_read_error' | 'stream_error';

export class LlmFailure extends Error {
  reason?: FailureReason;
  status?: number;
  rawOutput?: string;
  constructor(readonly code: LlmErrorCode, message: string, readonly details: ErrorDetails = {}) {
    super(message);
  }

  diagnose(reason: FailureReason, status?: number): this {
    this.reason = reason;
    this.status = status;
    return this;
  }
}

export function invalidOutput(label: string, text?: string, status?: number) {
  const error = new LlmFailure('invalid_output', `${label} did not return JSON that matches the requested schema.`);
  error.rawOutput = text;
  error.status = status;
  return error;
}

/** The wire carries JSON Schema, not executable Zod. Compile locally; never load remote refs. */
export function outputValidator(schema: LlmCompletion['schema']) {
  // A fresh registry prevents arbitrary caller schemas from registering persistent IDs or cache entries.
  const ajv = addFormats(new Ajv2020({ strict: false, strictSchema: true, ownProperties: true }));
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch {
    throw new LlmFailure('provider_rejected', 'The model request has an invalid or unsupported JSON Schema.');
  }
  return (text: string) => {
    try {
      const output: unknown = JSON.parse(text);
      if (!validate(output)) return undefined;
      return LlmOutput.safeParse(output).data;
    } catch {
      return undefined;
    }
  };
}
