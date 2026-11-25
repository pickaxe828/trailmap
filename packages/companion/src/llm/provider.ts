import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { LlmOutput, type ErrorDetails, type LlmCompletion, type LlmErrorCode, type LlmModel } from '@trailmap/shared';

export interface LlmProvider {
  complete(request: LlmCompletion): Promise<LlmOutput>;
  models(): Promise<LlmModel[]>;
}

export class LlmFailure extends Error {
  constructor(readonly code: LlmErrorCode, message: string, readonly details: ErrorDetails = {}) {
    super(message);
  }
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
