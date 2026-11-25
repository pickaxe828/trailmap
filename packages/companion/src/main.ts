/**
 * Companion entry point. Placeholder: the Native Messaging loop (length-prefixed
 * JSON on stdin/stdout) arrives with the companion spike (M0.5). For now the
 * binary only proves that the shared schemas bundle into `bun build --compile`.
 */
import { COMPANION_VERSION } from './handle';

if (process.argv.includes('--version')) {
  console.log(COMPANION_VERSION);
}
